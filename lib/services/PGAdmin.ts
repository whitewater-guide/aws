import * as ecs from '@aws-cdk/aws-ecs';
import * as cdk from '@aws-cdk/core';

import { SSM } from '../SSM';
import { Service } from './Service';

export class PGAdmin extends Service {
  constructor(scope: cdk.Construct, cluster: ecs.Cluster) {
    super(scope, {
      cluster,
      healthCheck: '/misc/ping',
      image: 'dpage/pgadmin4:4.28',
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
