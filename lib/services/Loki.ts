import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import { Service } from './Service';

interface Props {
  cluster: ecs.Cluster;
}

export class Loki extends Service {
  public static PORT = 3100;

  constructor(scope: Construct, props: Props) {
    const { cluster } = props;
    super(scope, {
      cluster,
      healthCheck: { path: '/ready' },
      image: 'ghcr.io/whitewater-guide/loki:1.0.0',
      name: 'loki',
      port: Loki.PORT,
      // logging: {
      // driver: LogDriver.AWS,
      // },
    });

    // Loki resides in a private subnet
    this.connections.allowFromAnyIpv4(ec2.Port.tcp(3100));
  }
}
