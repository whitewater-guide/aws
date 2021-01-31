import AWS from 'aws-sdk';
import chalk from 'chalk';
import { program } from 'commander';
import { URL } from 'url';

AWS.config.region = 'us-east-1';

const ecs = new AWS.ECS();
const rds = new AWS.RDS();

async function pgRestore(backupURL: string, skipGorge?: boolean) {
  try {
    new URL(backupURL);
  } catch (e) {
    throw new Error('You must provide backup URL as argument');
  }

  // Find PGRestore task definition
  const { taskDefinitionArns } = await ecs.listTaskDefinitions().promise();
  const def = taskDefinitionArns?.find((d) =>
    d.toLowerCase().includes('legacyrestore'),
  );
  if (!def) {
    throw new Error('DB restore task definition not found');
  }

  // Find cluster to run on
  const { clusterArns } = await ecs.listClusters().promise();
  const clusterArn = clusterArns?.[0];
  if (!clusterArn) {
    throw new Error('Could not find cluster to run restore task');
  }

  // Find db instance to restore on
  const { DBInstances } = await rds.describeDBInstances().promise();
  const db = DBInstances?.[0];
  if (!db) {
    throw new Error('Could not find db instance to restore on');
  }

  // Run
  console.info(`Running ${chalk.yellow(def)} on ${chalk.yellow(clusterArn)}`);
  console.info(`Skip gorge = ${chalk.yellow(!!skipGorge)}`);
  const environment: AWS.ECS.EnvironmentVariables = [
    { name: 'BACKUP_URL', value: backupURL },
  ];
  if (skipGorge) {
    environment.push({ name: 'SKIP_GORGE', value: 'true' });
  }
  const { failures } = await ecs
    .runTask({
      taskDefinition: def,
      cluster: clusterArn,
      launchType: 'FARGATE',
      count: 1,
      overrides: {
        containerOverrides: [
          {
            name: 'LegacyRestoreContainer',
            environment,
          },
        ],
      },
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: db.DBSubnetGroup!.Subnets!.map(
            (sn) => sn.SubnetIdentifier!,
          )!,
        },
      },
    })
    .promise();

  if (failures?.length) {
    console.error(chalk.red('Task failed'));
    console.error(JSON.stringify(failures, null, 2));
  }
}

program
  .arguments('<backupURL>')
  .option(
    '-g, --skip-gorge',
    'do not restore gorge measurements (takes a lot of time)',
  )
  .description('restores legacy (v2) backup into AWS')
  .action((backupURL: string, options: { skipGorge?: boolean }) => {
    pgRestore(backupURL, options.skipGorge).catch((e) =>
      console.error(chalk.red(e)),
    );
  });

program.parse(process.argv);
