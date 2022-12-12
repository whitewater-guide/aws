import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { Config } from '../config';
import { SSM } from '../SSM';
import { LogDriver, Service } from './Service';

interface Props {
  cluster: ecs.Cluster;
  postgresSecret: secretsmanager.ISecret;
}

export class Synapse extends Service {
  public static PORT = 8008;

  constructor(scope: Construct, props: Props) {
    const { cluster, postgresSecret } = props;
    const domainName = Config.get(scope, 'topLevelDomain');
    super(scope, {
      cluster,
      healthCheck: {
        path: '/health',
      },
      image: 'ghcr.io/whitewater-guide/synapse:1.4.5',
      name: 'synapse',
      port: Synapse.PORT,
      environment: {
        SERVER_NAME: domainName,
        PUBLIC_BASEURL: `https://synapse.${domainName}/`,
        POSTGRES_HOST: 'postgres.local',
      },
      secrets: {
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresSecret,
          'password',
        ),
        JWT_SECRET: SSM.secret(scope, SSM.ACCESS_TOKEN_SECRET),
        MACAROON_SECRET_KEY: SSM.secret(scope, SSM.SYNAPSE_MACAROON_KEY),
        REGISTRATION_SHARED_SECRET: SSM.secret(
          scope,
          SSM.SYNAPSE_REGISTRATION_SECRET,
        ),
        FORM_SECRET: SSM.secret(scope, SSM.SYNAPSE_FORM_SECRET),
        SIGNING_KEY: SSM.secret(scope, SSM.SYNAPSE_SIGNING_KEY),
      },
      logging: {
        driver: LogDriver.GRAFANA,
      },
      desiredCount: 1,
    });
  }
}
