import * as cdk from '@aws-cdk/core';

import { Config } from '../../config';
import PGInitProvider from './PGInitProvider';
import { PGInitProps, PGInitResourceProps } from './types';

/**
 * PGInit is custom resource that does following:
 * - initializes postgres extensions and creates two databases (wwguide and gorge)
 * - Launches Fargate ECS task that downloads latest backup from s3 and pg_restores it
 */
export class PGInit extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: PGInitProps) {
    super(scope, id);
    const { cluster, pgHost, pgPort, pgSecret } = props;

    const properties: PGInitResourceProps = {
      pgSecretArn: pgSecret.secretArn,
      pgHost: pgHost,
      pgPort: pgPort,
    };

    new cdk.CustomResource(this, 'PGInit', {
      serviceToken: PGInitProvider.getOrCreate(this, {
        vpc: cluster.vpc,
        isDev: Config.get(scope, 'isDev'),
        postgresSecretArn: pgSecret.secretArn,
      }),
      resourceType: 'Custom::PGInit',
      properties,
    });
  }
}
