#!/usr/bin/env node
import 'source-map-support/register';

import { App } from 'aws-cdk-lib';

import CertificatesStack from '../lib/certificates';
import { RootStack } from '../lib/RootStack';
import {
  devAccount,
  devImgproxySecretValue,
  devWildcardCertArn,
} from './aws-accounts';

const app = new App();

new CertificatesStack(app, 'CertificatesDev', {
  topLevelDomain: 'whitewater-dev.com',
  env: {
    account: devAccount,
    region: 'us-east-1',
  },
});

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
    crossAccount: {
      prodBackupsBucketName: 'backups.whitewater.guide',
    },
  },
  env: {
    account: devAccount,
    region: 'us-east-1',
  },
});

// new RootStack(app, 'Prod', {
//   config: {
//     topLevelDomain: 'whitewater.guide',
//     isDev: false,
//     wildcardCertArn: prodWildcardCertArn,
//     imgproxySecretValue: prodImgproxySecretValue,
//     crossAccount: {
//       devBackupTaskRoleArn,
//     },
//   },
//   env: {
//     account: prodAccount,
//     region: 'us-east-1',
//   },
// });
