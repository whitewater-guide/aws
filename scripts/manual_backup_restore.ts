import AWS from 'aws-sdk';
import chalk from 'chalk';
import { InvalidArgumentError, program } from 'commander';

type PgDumpRestoreVersion = 2 | 3;

function isValidPgDumpRestoreVersion(
  value: number,
): value is PgDumpRestoreVersion {
  return [2, 3].includes(value);
}

interface CommonOptions {
  profile: string;
  version: PgDumpRestoreVersion;
  host: string;
  password: string;
}

interface BackupOptions extends CommonOptions {
  skipPartitions?: boolean;
}

interface RestoreOptions extends CommonOptions {
  skipGorge?: boolean;
}

function parsePgDumpRestoreVersion(value: string): PgDumpRestoreVersion {
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError('not a number');
  }
  if (isValidPgDumpRestoreVersion(parsedValue)) {
    return parsedValue;
  } else {
    throw new InvalidArgumentError(
      'valid pg_dump_restore versions are 2 and 3',
    );
  }
}

function loadAWSProfile(profile: string) {
  const credentials = new AWS.SharedIniFileCredentials({ profile });
  console.info(chalk`Using AWS Profile: {green ${profile}}`);
  AWS.config.credentials = credentials;
  AWS.config.region = 'us-east-1';
}

async function runTask(
  task: 'backup' | 'restore',
  { version, host, password, profile }: CommonOptions,
  env: AWS.ECS.EnvironmentVariables = [],
) {
  loadAWSProfile(profile);
  // Must be initialized after loading profile
  const ecs = new AWS.ECS();
  const rds = new AWS.RDS();
  // Find task definition
  const { taskDefinitionArns } = await ecs.listTaskDefinitions().promise();

  const def = taskDefinitionArns?.find((d) =>
    d.toLowerCase().includes(`manualbackupv${version}`),
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
  const db = DBInstances?.find((dbi) => dbi.Endpoint?.Address === host);
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

  const { failures } = await ecs
    .runTask({
      taskDefinition: def,
      cluster: clusterArn,
      launchType: 'FARGATE',
      count: 1,
      overrides: {
        containerOverrides: [
          {
            name: 'BackupContainer',
            environment: [
              { name: 'PGHOST', value: host },
              { name: 'POSTGRES_PASSWORD', value: password },
              ...env,
            ],
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
  }
}

async function pgBackup({ skipPartitions, ...options }: BackupOptions) {
  await runTask(
    'backup',
    options,
    skipPartitions ? [{ name: 'SKIP_PARTITIONS', value: 'true' }] : [],
  );
}

async function pgRestore({ skipGorge, ...options }: RestoreOptions) {
  await runTask(
    'restore',
    options,
    skipGorge ? [{ name: 'SKIP_GORGE', value: 'true' }] : [],
  );
}

program
  .command('backup')
  .description('backs up whitewater.guide databases from AWS RDS into AWS S3')
  .requiredOption('--profile <profile>', 'aws profile to use')
  .requiredOption(
    '-v, --version <version>',
    'pg_dump_restore version to use',
    parsePgDumpRestoreVersion,
  )
  .requiredOption('-h, --host <host>', 'postgres host')
  .requiredOption('-p, --password <password>', 'postgres password')
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
  .requiredOption(
    '-v, --version <version>',
    'pg_dump_restore version to use',
    parsePgDumpRestoreVersion,
  )
  .requiredOption('-h, --host <host>', 'postgres host')
  .requiredOption('-p, --password <password>', 'postgres password')
  .option(
    '--skip-gorge',
    'do not restore gorge measurements (takes a lot of time)',
  )
  .action((options: RestoreOptions) => {
    pgRestore(options).catch((e) => {
      console.error(chalk.red(e));
      process.exit(1);
    });
  });

program.parse(process.argv);
