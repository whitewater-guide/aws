import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { ScheduledFargateTask } from 'aws-cdk-lib/aws-ecs-patterns';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';

import { Config } from '../config';
import { BackupTaskDefinition } from './BackupTaskDefinition';
import { PGInit } from './init';
import { Postgres13 } from './Postgres13';
import { DatabaseProps } from './types';

export class DatabaseStack extends Stack {
  constructor(scope: Construct, id: string, props: DatabaseProps & StackProps) {
    super(scope, id, props);
    const isDev = Config.get(scope, 'isDev');

    const pg13 = new Postgres13(this, props);
    new PGInit(this, 'PG13Init', { cluster: props.cluster, database: pg13 });

    new ScheduledFargateTask(this, 'ScheduledBackup', {
      cluster: props.cluster,
      scheduledFargateTaskDefinitionOptions: {
        taskDefinition: new BackupTaskDefinition(this, {
          postgresSecret: pg13.secret,
        }),
      },
      schedule: events.Schedule.rate(Duration.hours(24)),
      enabled: !isDev,
    });
  }
}
