import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { ScheduledFargateTask } from 'aws-cdk-lib/aws-ecs-patterns';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';

import { Config } from '../config';
import { BackupTaskDefinition } from './BackupTaskDefinition';
import { Postgres18 } from './Postgres18';
import { DatabaseProps } from './types';

export class DatabaseStack extends Stack {
  constructor(scope: Construct, id: string, props: DatabaseProps & StackProps) {
    super(scope, id, props);
    const isDev = Config.get(scope, 'isDev');

    const pg18 = new Postgres18(this, props);
    // const pg18Staging = new Postgres18Staging(this, props);
    // new Migrate13To18(this, 'Migrate13To18', {
    //   cluster: props.cluster,
    //   secrets: { pg13: pg13.secret, pg18: pg18Staging.secret },
    // });

    new ScheduledFargateTask(this, 'ScheduledBackup', {
      cluster: props.cluster,
      scheduledFargateTaskDefinitionOptions: {
        taskDefinition: new BackupTaskDefinition(this, {
          postgresSecret: pg18.secret,
        }),
      },
      schedule: events.Schedule.rate(Duration.hours(24)),
      enabled: !isDev,
    });
  }
}
