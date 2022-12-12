import AWS from 'aws-sdk';
import chalk from 'chalk';
import { program } from 'commander';
import waitFor from 'p-wait-for';

interface CommonOptions {
  profile: string;
}

interface BackupOptions extends CommonOptions {
  skipPartitions?: boolean;
}

interface RestoreOptions extends CommonOptions {
  skipGorge?: boolean;
  skipSynapse?: boolean;
  s3Bucket?: string;
}

interface MigrateOptions {
  from: string;
  to: string;
}

function loadAWSProfile(profile: string) {
  const credentials = new AWS.SharedIniFileCredentials({ profile });
  console.info(chalk`Using AWS Profile: {green ${profile}}`);
  AWS.config.credentials = credentials;
  AWS.config.region = 'us-east-1';
}

async function waitForTaskCompletion(
  clusterArn: string,
  taskArn: string,
): Promise<boolean> {
  const ecs = new AWS.ECS();
  const { tasks } = await ecs
    .describeTasks({
      cluster: clusterArn,
      tasks: [taskArn],
    })
    .promise();

  // If an error is thrown, the framework will submit a "FAILED" response to AWS CloudFormation
  if (tasks?.length !== 1) {
    throw new Error('should have exactly one task');
  }
  const task = tasks[0];
  if (task.containers?.length !== 1) {
    throw new Error('task should have exactly one container');
  }
  const container = task.containers[0];
  if (
    task.lastStatus === 'STOPPED' &&
    task.stopCode !== 'EssentialContainerExited'
  ) {
    throw new Error(
      `Task stopped with code '${task.stopCode}': ${task.stoppedReason}`,
    );
  }
  if (container.lastStatus === 'STOPPED' && container.exitCode !== 0) {
    throw new Error(`container exited with code ${container.exitCode}`);
  }

  return task.lastStatus === 'STOPPED';
}

async function runTask(
  task: 'backup' | 'restore',
  { profile }: CommonOptions,
  env: AWS.ECS.EnvironmentVariables = [],
) {
  loadAWSProfile(profile);
  // Must be initialized after loading profile
  const ecs = new AWS.ECS();
  const rds = new AWS.RDS();
  // Find task definition
  const { taskDefinitionArns } = await ecs.listTaskDefinitions().promise();

  const def = taskDefinitionArns?.find((d) =>
    d.toLowerCase().includes('backup'),
  );
  if (!def) {
    throw new Error('DB backup/restore task definition not found');
  }

  // Find cluster to run on
  const { clusterArns } = await ecs.listClusters().promise();
  const clusterArn = clusterArns?.[0];
  if (!clusterArn) {
    throw new Error('Could not find cluster arn to run restore task');
  }

  // Find db instance to restore on
  const { DBInstances } = await rds.describeDBInstances().promise();
  const db = DBInstances?.[0];
  if (!db) {
    throw new Error('Could not find db instance to restore on');
  }
  if (!db.DBSubnetGroup?.Subnets) {
    throw new Error('Could not find db subnets');
  }
  const subnets = db.DBSubnetGroup.Subnets.map(
    (sn) => sn.SubnetIdentifier,
  ).filter((s): s is string => !!s);

  // Run
  console.info(
    chalk`Running {yellow ${task}} task {green ${def}} on {green ${clusterArn}}`,
  );

  const { failures, tasks } = await ecs
    .runTask({
      taskDefinition: def,
      cluster: clusterArn,
      launchType: 'FARGATE',
      count: 1,
      overrides: {
        containerOverrides: [
          {
            name: 'BackupContainer',
            environment: env,
            command: [`/app/${task}.sh`],
          },
        ],
      },
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
        },
      },
    })
    .promise();

  if (failures?.length) {
    console.error(chalk.red(`${task} task failed`));
    console.error(JSON.stringify(failures, null, 2));
    return;
  }

  const taskArn = tasks?.[0].taskArn;
  if (!taskArn) {
    console.error(chalk.red(`${task} did not create task`));
    return;
  }

  await waitFor(() => waitForTaskCompletion(clusterArn, taskArn), {
    interval: 5000,
  });
}

async function pgBackup({ skipPartitions, ...options }: BackupOptions) {
  await runTask(
    'backup',
    options,
    skipPartitions ? [{ name: 'SKIP_PARTITIONS', value: 'true' }] : [],
  );
}

async function pgRestore({
  skipGorge,
  s3Bucket,
  skipSynapse,
  ...options
}: RestoreOptions) {
  const env: AWS.ECS.EnvironmentVariables = [];
  if (skipGorge) {
    env.push({ name: 'SKIP_GORGE', value: 'true' });
  }
  if (skipSynapse) {
    env.push({ name: 'SKIP_SYNAPSE', value: 'true' });
  }
  if (s3Bucket) {
    env.push({ name: 'S3_BUCKET', value: s3Bucket });
  }
  await runTask('restore', options, env);
}

program
  .command('backup')
  .description('backs up whitewater.guide databases from AWS RDS into AWS S3')
  .requiredOption('--profile <profile>', 'aws profile to use')
  .option('--skip-partitions', 'do not archive old measurements partitions')
  .action((options: BackupOptions) => {
    pgBackup(options).catch((e) => {
      console.error(chalk.red(e));
      process.exit(1);
    });
  });

program
  .command('restore')
  .description('restores whitewater.guide databases from AWS S3 into AWS RDS')
  .requiredOption('--profile <profile>', 'aws profile to use')
  .option(
    '--skip-gorge',
    'do not restore gorge measurements (takes a lot of time)',
  )
  .option('--skip-synapse', 'do not restore synapse db')
  .action((options: RestoreOptions) => {
    pgRestore(options).catch((e) => {
      console.error(chalk.red(e));
      process.exit(1);
    });
  });

program
  .command('migrate')
  .description(
    'restores whitewater.guide databases from one account into another',
  )
  .requiredOption('--from <profile>', 'aws profile to of source database')
  .requiredOption('--to <profile>', 'aws profile to of destination database')
  .action(async (options: MigrateOptions) => {
    try {
      await pgBackup({ skipPartitions: true, profile: options.from });
      // Restore from production bucket
      await pgRestore({
        profile: options.to,
        s3Bucket: 'backups.whitewater.guide',
      });
    } catch (e) {
      console.error(chalk.red(e));
      process.exit(1);
    }
  });

program.parse(process.argv);
