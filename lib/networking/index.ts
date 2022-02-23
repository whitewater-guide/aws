import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import Cluster from './Cluster';

export interface NetworkingStackProps {
  maxAzs?: number;
}

export class NetworkingStack extends Stack {
  public readonly cluster: ecs.Cluster;

  constructor(
    scope: Construct,
    id: string,
    props: NetworkingStackProps & StackProps,
  ) {
    super(scope, id, props);
    // Rds requires at least 2 azs
    const { maxAzs = 2 } = props;

    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs,
      natGateways: 1,
      natGatewayProvider: ec2.NatProvider.instance({
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.NANO,
        ),
      }),
    });
    Tags.of(vpc).add('wwguide:vpc', 'true');

    this.cluster = new Cluster(this, 'Cluster', vpc);
  }
}
