import * as ecs from '@aws-cdk/aws-ecs';
import * as cdk from '@aws-cdk/core';

import { Service } from './Service';

export class PGAdmin extends Service {
  constructor(scope: cdk.Construct, cluster: ecs.Cluster) {
    super(scope, {
      cluster,
      healthCheck: '/misc/ping',
      image: 'dpage/pgadmin4:4.25',
      name: 'pgadmin',
      port: 80,
      environment: {
        PGADMIN_DEFAULT_EMAIL: 'admin@admin.com',
        PGADMIN_DEFAULT_PASSWORD: 'PGADMIN_DEFAULT_PASSWORD',
      },
    });
  }
}
