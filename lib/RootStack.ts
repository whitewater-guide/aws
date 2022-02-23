import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import AppTags from './AppTags';
import { Config } from './config';
import { DatabaseStack } from './database';
import { NetworkingStack } from './networking';
import { ServicesStack } from './services';
import { AppConfig } from './types';
import { WebStack } from './web';

interface Props extends StackProps {
  config: AppConfig;
}

export class RootStack extends Stack {
  constructor(scope: Construct, id: string, { config, ...props }: Props) {
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

    Tags.of(this).add(...AppTags.Stoppable);
  }
}
