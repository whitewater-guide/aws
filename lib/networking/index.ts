import { Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as ecs from 'aws-cdk-lib/aws-ecs';
import { FckNatInstanceProvider } from 'cdk-fck-nat';
import type { Construct } from 'constructs';
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

    const natGatewayProvider = new FckNatInstanceProvider({
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.NANO,
      ),
    });

    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs,
      natGateways: 1,
      natGatewayProvider,
    });

    Tags.of(vpc).add('wwguide:vpc', 'true');
    natGatewayProvider.securityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
    );

    this.cluster = new Cluster(this, 'Cluster', vpc);
  }
}
