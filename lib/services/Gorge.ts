import * as ecs from '@aws-cdk/aws-ecs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Service } from './Service';

interface Props {
  postgresPassword: secretsmanager.ISecret;
  cluster: ecs.Cluster;
}

export class Gorge extends Service {
  public static PORT = 7080;

  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, postgresPassword } = props;
    super(scope, {
      cluster,
      healthCheck: '/version',
      image: 'ghcr.io/whitewater-guide/gorge:1.20.2',
      name: 'gorge',
      port: Gorge.PORT,
      command: [
        '--cache',
        'inmemory', // in the beginning of 2021 total redis database size on production was 700kb, I think we can afford to fit it in memory
        '--pg-host',
        'postgres.local',
        '--pg-db',
        'gorge',
        '--pg-without-timescale',
        '--db-chunk-size',
        '1000',
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
