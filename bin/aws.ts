#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from '@aws-cdk/core';

import { RootStack } from '../lib/RootStack';
import { devAccount } from './aws-accounts';

const app = new cdk.App();

new RootStack(app, 'Dev', {
  topLevelDomain: 'whitewater-dev.com',
  isDev: true,
  env: {
    account: devAccount,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
