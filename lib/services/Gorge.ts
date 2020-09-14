import * as ecs from '@aws-cdk/aws-ecs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { RootProps } from '../types';
import { Service } from './Service';

interface Props extends RootProps {
  postgresPassword: secretsmanager.ISecret;
  cluster: ecs.Cluster;
}

export class Gorge extends Service {
  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, postgresPassword } = props;
    super(scope, {
      cluster,
      healthCheck: '/version',
      image: 'ghcr.io/whitewater-guide/gorge:1.19.4',
      name: 'gorge',
      port: 7080,
      command: [
        '--pg-host',
        'postgres.local',
        '--pg-db',
        'gorge',
        '--pg-without-timescale',
        '--db-chunk-size',
        '1000',
        '--redis-host',
        'redis.local',
      ],
      environment: {
        POSTGRES_PASSWORD: postgresPassword
          .secretValueFromJson('password')
          .toString(),
      },
      enableLogging: true,
    });
  }
}
