import * as ecs from '@aws-cdk/aws-ecs';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { SSM } from '../SSM';
import { RootProps } from '../types';
import { Service } from './Service';

interface Props extends RootProps {
  cluster: ecs.Cluster;
  postgresPassword: secretsmanager.ISecret;
  contentBucket: s3.Bucket;
}

export class Api extends Service {
  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, postgresPassword, topLevelDomain, contentBucket } = props;
    super(scope, {
      cluster,
      healthCheck: '/ping',
      image: 'ghcr.io/whitewater-guide/backend:0.0.452',
      name: 'api',
      port: 3333,
      environment: {
        NODE_ENV: 'production',
        ROOT_DOMAIN: topLevelDomain,

        MAIL_SMTP_SERVER: SSM.string(scope, SSM.MAIL_SMTP_SERVER),
        MAIL_PASSWORD: SSM.secret(scope, SSM.MAIL_PASSWORD),
        MAIL_NOREPLY_BOX: SSM.string(scope, SSM.MAIL_NOREPLY_BOX),
        MAIL_INFO_BOX: SSM.string(scope, SSM.MAIL_INFO_BOX),
        MAILCHIMP_API_KEY: SSM.secret(scope, SSM.MAILCHIMP_API_KEY),
        MAILCHIMP_LIST_ID: SSM.string(scope, SSM.MAILCHIMP_LIST_ID),

        IMGPROXY_KEY: SSM.secret(scope, SSM.IMGPROXY_KEY),
        IMGPROXY_SALT: SSM.secret(scope, SSM.IMGPROXY_SALT),

        ACCESS_TOKEN_SECRET: SSM.secret(scope, SSM.ACCESS_TOKEN_SECRET),
        REFRESH_TOKEN_SECRET: SSM.secret(scope, SSM.REFRESH_TOKEN_SECRET),
        DESCENTS_TOKEN_SECRET: SSM.secret(scope, SSM.DESCENTS_TOKEN_SECRET),

        FB_APP_ID: SSM.string(scope, SSM.FB_APP_ID),
        FB_SECRET: SSM.secret(scope, SSM.FB_SECRET),

        GOOGLE_SERVICE_ACCOUNT: SSM.secret(scope, SSM.GOOGLE_SERVICE_ACCOUNT),

        POSTGRES_HOST: 'postgres.local',
        POSTGRES_DB: 'wwguide',
        POSTGRES_PASSWORD: postgresPassword
          .secretValueFromJson('password')
          .toString(),
      },
      enableLogging: true,
      desiredCount: props.isDev ? 1 : 2,
    });
    // service.connections.allowFromAnyIpv4(ec2.Port.tcp(3333));
    contentBucket.grantReadWrite(this.executionRole);
  }
}
