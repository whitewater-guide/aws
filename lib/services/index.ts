import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import { ScheduledFargateTask } from '@aws-cdk/aws-ecs-patterns';
import * as events from '@aws-cdk/aws-events';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';
import { Api } from './Api';
import { BackupTaskDefinition } from './BackupTaskDefinition';
import { Gorge } from './Gorge';
import { Imgproxy } from './Imgproxy';
import { LoadBalancer } from './LoadBalancer';
import { PGAdmin } from './PGAdmin';

export interface ServicesStackProps {
  cluster: ecs.Cluster;
  postgresSecret: secretsmanager.ISecret;
  contentBucket: s3.Bucket;
}

type Props = ServicesStackProps & cdk.StackProps;

export class ServicesStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id, props);
    const { cluster } = props;

    const api = new Api(this, props);
    const gorge = new Gorge(this, props);
    const imgproxy = new Imgproxy(this, props);
    const pgadmin = new PGAdmin(this, cluster);

    gorge.connections.allowFrom(api, ec2.Port.tcp(Gorge.PORT));

    const balancer = new LoadBalancer(this, props);
    balancer.addServiceTarget(100, 'api', api.listenerTargetProps);
    balancer.addServiceTarget(200, 'pgadmin', pgadmin.listenerTargetProps);
    balancer.addServiceTarget(300, 'imgproxy', imgproxy.listenerTargetProps);

    const isDev = Config.get(scope, 'isDev');

    new ScheduledFargateTask(this, 'ScheduledBackup', {
      cluster,
      scheduledFargateTaskDefinitionOptions: {
        taskDefinition: new BackupTaskDefinition(this, props),
      },
      schedule: events.Schedule.rate(cdk.Duration.hours(24)),
      enabled: !isDev,
    });
  }
}
