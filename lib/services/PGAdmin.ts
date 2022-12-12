import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

import { SSM } from '../SSM';
import { Service } from './Service';

export class PGAdmin extends Service {
  constructor(scope: Construct, cluster: ecs.Cluster) {
    super(scope, {
      cluster,
      healthCheck: { path: '/misc/ping' },
      // This is the latest version that works: https://stackoverflow.com/questions/69604497/healthcheck-request-timed-out-when-running-pgadminin-ecs
      image: 'dpage/pgadmin4:4.30',
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
