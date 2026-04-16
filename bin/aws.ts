#!/usr/bin/env node
import 'source-map-support/register';

import { App } from 'aws-cdk-lib';
import { CanadaStack } from '../lib/canada';
import { RootStack } from '../lib/RootStack';
import {
  prodAccount,
  prodImgproxySecretValue,
  prodWildcardCertArn,
} from './aws-accounts';

const app = new App();

new RootStack(app, 'Prod', {
  config: {
    topLevelDomain: 'whitewater.guide',
    isDev: false,
    wildcardCertArn: prodWildcardCertArn,
    imgproxySecretValue: prodImgproxySecretValue,
  },
  env: {
    account: prodAccount,
    region: 'us-east-1',
  },
});

new CanadaStack(app, 'Canada', {
  env: {
    account: prodAccount,
    region: 'ca-central-1',
  },
});
