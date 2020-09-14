import * as cert from '@aws-cdk/aws-certificatemanager';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as ecs from '@aws-cdk/aws-ecs';
import * as route53 from '@aws-cdk/aws-route53';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';

import { SSM } from '../SSM';
import { RootProps } from '../types';
import { Service } from './Service';

interface Props extends RootProps {
  cluster: ecs.Cluster;
  contentBucket: s3.Bucket;
}

export class Imgproxy extends Service {
  constructor(scope: cdk.Construct, props: Props) {
    const { cluster, contentBucket, topLevelDomain } = props;

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
        IMGPROXY_KEY: SSM.secret(scope, SSM.IMGPROXY_KEY),
        IMGPROXY_SALT: SSM.secret(scope, SSM.IMGPROXY_SALT),
        IMGPROXY_SECRET: SSM.secret(scope, SSM.IMGPROXY_SECRET),
      },
    });

    contentBucket.grantRead(this.executionRole);

    const domainName = `content.${topLevelDomain}`;

    const hostedZone = route53.HostedZone.fromLookup(
      scope,
      'ContentHostedZone',
      {
        domainName: topLevelDomain,
        privateZone: false,
      },
    );

    const certificate = new cert.DnsValidatedCertificate(
      scope,
      `ContentCertificate`,
      {
        domainName,
        hostedZone,
        region: 'us-east-1',
      },
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
  }
}
