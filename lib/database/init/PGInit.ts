import * as cdk from '@aws-cdk/core';

import { Config } from '../../config';
import PGInitProvider from './PGInitProvider';
import { PGInitProps, PGInitResourceProps } from './types';

/**
 * PGInit is custom resource that does following:
 * - initializes postgres extensions and creates two databases (wwguide and gorge)
 */
export class PGInit extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: PGInitProps) {
    super(scope, id);
    const { cluster, database } = props;

    const properties: PGInitResourceProps = {
      pgSecretArn: database.secret.secretArn,
      pgHost: database.host,
      pgPort: database.port,
    };

    new cdk.CustomResource(this, 'PGInit', {
      serviceToken: PGInitProvider.getOrCreate(this, {
        vpc: cluster.vpc,
        isDev: Config.get(scope, 'isDev'),
      }),
      resourceType: 'Custom::PGInit',
      properties,
    });
  }
}
