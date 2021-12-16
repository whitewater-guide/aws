import * as ecs from '@aws-cdk/aws-ecs';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';
import { SSM } from '../SSM';
import { Service } from './Service';

interface Props {
  cluster: ecs.Cluster;
  postgresSecret: secretsmanager.ISecret;
  contentBucket: s3.Bucket;
}

export class Api extends Service {
  public static PORT = 3333;

  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, postgresSecret, contentBucket } = props;
    super(scope, {
      cluster,
      healthCheck: {
        path: '/ping',
      },
      image: 'ghcr.io/whitewater-guide/backend:0.0.489',
      name: 'api',
      port: Api.PORT,
      environment: {
        NODE_ENV: 'production',
        ROOT_DOMAIN: Config.get(scope, 'topLevelDomain'),

        MAIL_SMTP_SERVER: SSM.string(scope, SSM.MAIL_SMTP_SERVER),
        MAIL_NOREPLY_BOX: SSM.string(scope, SSM.MAIL_NOREPLY_BOX),
        MAIL_INFO_BOX: SSM.string(scope, SSM.MAIL_INFO_BOX),
        MAILCHIMP_LIST_ID: SSM.string(scope, SSM.MAILCHIMP_LIST_ID),

        FB_APP_ID: SSM.string(scope, SSM.FB_APP_ID),

        POSTGRES_HOST: 'postgres.local',
        POSTGRES_DB: 'wwguide',
        CORS_WHITELIST: 'localhost',
      },
      secrets: {
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresSecret,
          'password',
        ),
        MAIL_PASSWORD: SSM.secret(scope, SSM.MAIL_PASSWORD),
        MAILCHIMP_API_KEY: SSM.secret(scope, SSM.MAILCHIMP_API_KEY),
        IMGPROXY_KEY: SSM.secret(scope, SSM.IMGPROXY_KEY),
        IMGPROXY_SALT: SSM.secret(scope, SSM.IMGPROXY_SALT),
        ACCESS_TOKEN_SECRET: SSM.secret(scope, SSM.ACCESS_TOKEN_SECRET),
        REFRESH_TOKEN_SECRET: SSM.secret(scope, SSM.REFRESH_TOKEN_SECRET),
        DESCENTS_TOKEN_SECRET: SSM.secret(scope, SSM.DESCENTS_TOKEN_SECRET),
        FB_SECRET: SSM.secret(scope, SSM.FB_SECRET),
        GOOGLE_SERVICE_ACCOUNT: SSM.secret(scope, SSM.GOOGLE_SERVICE_ACCOUNT),
        GORGE_HEALTH_KEY: SSM.secret(scope, SSM.GORGE_HEALTH_KEY),
        GORGE_HEALTH_EMAILS: SSM.secret(scope, SSM.GORGE_HEALTH_EMAILS),
      },
      enableLogging: true,
      desiredCount: Config.get(scope, 'isDev') ? 1 : 2,
    });
    contentBucket.grantReadWrite(this.taskRole);
  }
}
