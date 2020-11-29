import * as cert from '@aws-cdk/aws-certificatemanager';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as ecs from '@aws-cdk/aws-ecs';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';
import { SSM } from '../SSM';
import { Service } from './Service';

interface Props {
  cluster: ecs.Cluster;
  contentBucket: s3.Bucket;
}

export class Imgproxy extends Service {
  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, contentBucket } = props;

    const isDev = Config.get(scope, 'isDev');

    super(scope, {
      cluster,
      healthCheck: '/health',
      image: 'darthsim/imgproxy:v2.15',
      name: 'imgproxy',
      port: 8080,
      environment: {
        IMGPROXY_USE_S3: 'true',
        IMGPROXY_S3_REGION: cdk.Stack.of(scope).region,
        IMGPROXY_USE_ETAG: 'true',
        IMGPROXY_GZIP_COMPRESSION: '0',
        IMGPROXY_ALLOWED_SOURCES: 's3://',
        IMGPROXY_LOG_FORMAT: 'json',
        IMGPROXY_TTL: '31536000', // 1 year
        IMGPROXY_LOG_LEVEL: isDev ? 'debug' : 'info',
      },
      secrets: {
        IMGPROXY_KEY: SSM.secret(scope, SSM.IMGPROXY_KEY),
        IMGPROXY_SALT: SSM.secret(scope, SSM.IMGPROXY_SALT),
        IMGPROXY_SECRET: SSM.secret(scope, SSM.IMGPROXY_SECRET),
      },
      enableLogging: isDev,
    });

    contentBucket.grantRead(this.taskRole);

    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const domainName = `content.${topLevelDomain}`;

    const certificate = cert.Certificate.fromCertificateArn(
      scope,
      'ImgproxyCert',
      Config.get(scope, 'wildcardCertArn'),
    );

    const distribution = new cloudfront.Distribution(
      scope,
      'ContentDistribution',
      {
        defaultBehavior: {
          origin: new origins.HttpOrigin(`imgproxy.${topLevelDomain}`, {
            customHeaders: {
              Authorization: `Bearer ${SSM.secret(scope, SSM.IMGPROXY_SECRET)}`,
            },
          }),
        },
        domainNames: [domainName],
        certificate,
      },
    );

    const hostedZone = route53.HostedZone.fromLookup(
      scope,
      'ContentHostedZone',
      {
        domainName: topLevelDomain,
        privateZone: false,
      },
    );

    new route53.ARecord(scope, 'ContentCloudfrontAlias', {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
      zone: hostedZone,
    });
  }
}
