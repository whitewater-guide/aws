#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from '@aws-cdk/core';

import { RootStack } from '../lib/RootStack';
import {
  devAccount,
  devImgproxySecretValue,
  devWildcardCertArn,
} from './aws-accounts';

const app = new cdk.App();

// Deployed manually once to avoid hitting limit on number of cert requests
// import CertificatesStack from '../lib/certificates';
// new CertificatesStack(app, 'CertificatesDev', {
//   topLevelDomain: 'whitewater-dev.com',
//   env: {
//     account: devAccount,
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
