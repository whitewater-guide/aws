#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from '@aws-cdk/core';

import { RootStack } from '../lib/RootStack';
import {
  devAccount,
  devImgproxySecretValue,
  prodAccount,
  prodImgproxySecretValue,
  prodWildcardCertArn,
} from './aws-accounts';
import { devWildcardCertArn } from './aws-accounts.example';

const app = new cdk.App();

// new CertificatesStack(app, 'CertificatesDev', {
//   topLevelDomain: 'whitewater-dev.com',
//   env: {
//     account: devAccount,
//     region: 'us-east-1',
//   },
// });

// new CertificatesStack(app, 'CertificatesProd', {
//   topLevelDomain: 'whitewater.guide',
//   env: {
//     account: prodAccount,
//     region: 'us-east-1',
//   },
// });

new RootStack(app, 'Dev', {
  config: {
    topLevelDomain: 'whitewater-dev.com',
    isDev: true,
    wildcardCertArn: devWildcardCertArn,
    imgproxySecretValue: devImgproxySecretValue,
  },
  env: {
    account: devAccount,
    region: 'us-east-1',
  },
});

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
