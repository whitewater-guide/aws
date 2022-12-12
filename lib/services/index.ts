import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { POSTGRES_SECRET_NAME } from '../database/constants';
import { Api } from './Api';
import { Gorge } from './Gorge';
import { Grafana } from './Grafana';
import { Imgproxy } from './Imgproxy';
import { LoadBalancer } from './LoadBalancer';
import { Loki } from './Loki';
import { PGAdmin } from './PGAdmin';
import { Synapse } from './Synapse';

export interface ServicesStackProps {
  cluster: ecs.Cluster;
  contentBucket: s3.Bucket;
}

type Props = ServicesStackProps & StackProps;

export class ServicesStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
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
    const synapse = new Synapse(this, { ...props, postgresSecret });
    const grafana = new Grafana(this, props);

    new Loki(this, props);

    gorge.connections.allowFrom(api, ec2.Port.tcp(Gorge.PORT));
    api.connections.allowFrom(gorge, ec2.Port.tcp(Api.PORT));
    synapse.connections.allowFrom(api, ec2.Port.tcp(Synapse.PORT));

    const balancer = new LoadBalancer(this, props);
    balancer.addServiceTarget(100, 'api', api.listenerTargetProps);
    balancer.addServiceTarget(200, 'synapse', synapse.listenerTargetProps);
    balancer.addServiceTarget(300, 'pgadmin', pgadmin.listenerTargetProps);
    balancer.addServiceTarget(400, 'imgproxy', imgproxy.listenerTargetProps);
    balancer.addServiceTarget(500, 'grafana', grafana.listenerTargetProps);
  }
}
