import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as cdk from '@aws-cdk/core';

import Cluster from './Cluster';

export interface NetworkingStackProps {
  maxAzs?: number;
}

export class NetworkingStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: NetworkingStackProps & cdk.StackProps,
  ) {
    super(scope, id, props);
    // Rds requires at least 2 azs
    const { maxAzs = 2 } = props;

    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs,
      // We only need NAT to pull docker images
      natGateways: 1,
      natGatewayProvider: ec2.NatProvider.instance({
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MICRO,
        ),
      }),
    });

    this.cluster = new Cluster(this, 'Cluster', vpc);
  }
}
