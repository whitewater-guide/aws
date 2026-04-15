#!/usr/bin/env node
import 'source-map-support/register';

import { App } from 'aws-cdk-lib';

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
