import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import { SSM } from '../SSM';
import { Service } from './Service';

export class PGAdmin extends Service {
  constructor(scope: Construct, cluster: ecs.Cluster) {
    super(scope, {
      cluster,
      healthCheck: { path: '/', healthyHttpCodes: '200-499' },
      // This is the latest version that works: https://stackoverflow.com/questions/69604497/healthcheck-request-timed-out-when-running-pgadminin-ecs
      image: 'dpage/pgadmin4:9.14.0',
      name: 'pgadmin',
      port: 80,
      secrets: {
        PGADMIN_DEFAULT_EMAIL: SSM.secret(scope, SSM.PGADMIN_DEFAULT_EMAIL),
        PGADMIN_DEFAULT_PASSWORD: SSM.secret(
          scope,
          SSM.PGADMIN_DEFAULT_PASSWORD,
        ),
      },
    });
  }
}
