import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import { Service } from './Service';

interface Props {
  cluster: ecs.Cluster;
}

export class Grafana extends Service {
  public static PORT = 3000;

  constructor(scope: Construct, props: Props) {
    const { cluster } = props;
    super(scope, {
      cluster,
      healthCheck: { path: '/api/health' },
      image: 'ghcr.io/whitewater-guide/grafana:9.2.5',
      name: 'grafana',
      port: Grafana.PORT,
      // logging: {
      // driver: LogDriver.AWS,
      // },
    });

    // Loki resides in a private subnet
    this.connections.allowFromAnyIpv4(ec2.Port.tcp(3100));
  }
}
