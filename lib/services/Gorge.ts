import * as ecs from '@aws-cdk/aws-ecs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Service } from './Service';

interface Props {
  postgresSecret: secretsmanager.ISecret;
  cluster: ecs.Cluster;
}

export class Gorge extends Service {
  public static PORT = 7080;

  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, postgresSecret } = props;
    super(scope, {
      cluster,
      healthCheck: '/version',
      image: 'ghcr.io/whitewater-guide/gorge:1.27.0',
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
        // Warning! When set to debug, this produces hellish amount of logs, which will cost you some $$$ in AWS CloudWatch
        'info',
      ],
      secrets: {
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresSecret,
          'password',
        ),
      },
      enableLogging: true,
    });
  }
}
