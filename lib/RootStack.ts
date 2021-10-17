import * as cdk from '@aws-cdk/core';

import { Config } from './config';
import { DatabaseStack } from './database';
import { NetworkingStack } from './networking';
import { ServicesStack } from './services';
import Tags from './Tags';
import { AppConfig } from './types';
import { WebStack } from './web';

interface Props extends cdk.StackProps {
  config: AppConfig;
}

export class RootStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, { config, ...props }: Props) {
    super(scope, id, props);
    Config.set(scope, config);

    const net = new NetworkingStack(this, 'Net', props);
    this.addDependency(net);

    const web = new WebStack(this, 'Web', props);
    this.addDependency(web);

    const db = new DatabaseStack(this, 'Db', {
      ...props,
      cluster: net.cluster,
    });
    this.addDependency(db);

    const services = new ServicesStack(this, 'Services', {
      ...props,
      cluster: net.cluster,
      contentBucket: web.buckets.contentBucket,
    });
    this.addDependency(services);

    cdk.Tags.of(this).add(...Tags.Stoppable);
  }
}
