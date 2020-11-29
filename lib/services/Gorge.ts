import * as ecs from '@aws-cdk/aws-ecs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Service } from './Service';

interface Props {
  postgresPassword: secretsmanager.ISecret;
  cluster: ecs.Cluster;
}

export class Gorge extends Service {
  private static PORT = 7080;

  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, postgresPassword } = props;
    super(scope, {
      cluster,
      healthCheck: '/version',
      image: 'ghcr.io/whitewater-guide/gorge:1.19.5',
      name: 'gorge',
      port: Gorge.PORT,
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
        '--log-level',
        'info',
      ],
      secrets: {
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresPassword,
          'password',
        ),
      },
      enableLogging: true,
    });
  }
}
