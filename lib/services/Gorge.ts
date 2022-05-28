import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { SSM } from '../SSM';
import { Api } from './Api';
import { Service } from './Service';

interface Props {
  postgresSecret: secretsmanager.ISecret;
  cluster: ecs.Cluster;
}

export class Gorge extends Service {
  public static PORT = 7080;

  constructor(scope: Construct, props: Props) {
    const { cluster, postgresSecret } = props;
    super(scope, {
      cluster,
      healthCheck: { path: '/version' },
      image: 'ghcr.io/whitewater-guide/gorge:3.1.2',
      name: 'gorge',
      port: Gorge.PORT,
      command: [
        '--cache',
        'inmemory', // in the beginning of 2021 total redis database size on production was 700kb, I think we can afford to fit it in memory
        '--pg-host',
        'postgres.local',
        '--pg-db',
        'gorge',
        '--db-chunk-size',
        '1000',
        '--log-level',
        // Warning! When set to debug, this produces hellish amount of logs, which will cost you some $$$ in AWS CloudWatch
        'info',
        '--hooks-health-url',
        `http://api.local:${Api.PORT}/gorge/health`,
        '--hooks-health-headers',
        'x-api-key: $GORGE_HEALTH_KEY', // this env is evaluated by gorge during runtime, not by docker!
      ],
      secrets: {
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresSecret,
          'password',
        ),
        GORGE_HEALTH_KEY: SSM.secret(scope, SSM.GORGE_HEALTH_KEY),
      },
      enableLogging: false,
    });
  }
}
