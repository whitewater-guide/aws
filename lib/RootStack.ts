import * as cdk from '@aws-cdk/core';

import { DatabaseStack } from './database';
import { NetworkingStack } from './networking';
import { ServicesStack } from './services';
import { RootProps } from './types';
import { WebStack } from './web';

export class RootStack extends cdk.Stack {
  constructor(
    scope: cdk.Construct,
    id: string,
    props: RootProps & cdk.StackProps,
  ) {
    super(scope, id, props);

    const net = new NetworkingStack(this, 'Net', props);
    this.addDependency(net);

    const web = new WebStack(this, 'Web', {
      ...props,
    });
    this.addDependency(web);

    const db = new DatabaseStack(this, 'Db', {
      ...props,
      cluster: net.cluster,
    });
    this.addDependency(db);

    const services = new ServicesStack(this, 'Services', {
      ...props,
      cluster: net.cluster,
      postgresPassword: db.posgres.secret,
      contentBucket: web.buckets.contentBucket,
    });
    this.addDependency(services);
  }
}
