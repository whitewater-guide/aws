import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { POSTGRES_SECRET_NAME } from '../database/constants';
import { Api } from './Api';
import { Gorge } from './Gorge';
import { Imgproxy } from './Imgproxy';
import { LoadBalancer } from './LoadBalancer';
import { PGAdmin } from './PGAdmin';

export interface ServicesStackProps {
  cluster: ecs.Cluster;
  contentBucket: s3.Bucket;
}

type Props = ServicesStackProps & cdk.StackProps;

export class ServicesStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id, props);
    const { cluster } = props;
    const postgresSecret = secretsmanager.Secret.fromSecretNameV2(
      scope,
      'PGSecret',
      POSTGRES_SECRET_NAME,
    );

    const api = new Api(this, { ...props, postgresSecret });
    const gorge = new Gorge(this, { ...props, postgresSecret });
    const imgproxy = new Imgproxy(this, props);
    const pgadmin = new PGAdmin(this, cluster);

    gorge.connections.allowFrom(api, ec2.Port.tcp(Gorge.PORT));
    api.connections.allowFrom(gorge, ec2.Port.tcp(Api.PORT));

    const balancer = new LoadBalancer(this, props);
    balancer.addServiceTarget(100, 'api', api.listenerTargetProps);
    balancer.addServiceTarget(200, 'pgadmin', pgadmin.listenerTargetProps);
    balancer.addServiceTarget(300, 'imgproxy', imgproxy.listenerTargetProps);
  }
}
