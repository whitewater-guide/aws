import * as cert from '@aws-cdk/aws-certificatemanager';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import upperFirst from 'lodash/upperFirst';

import { RootProps } from '../types';

export class BucketDistribution extends cloudfront.Distribution {
  constructor(
    scope: cdk.Construct,
    bucket: s3.Bucket,
    subDomain = '',
    props: RootProps,
  ) {
    const { topLevelDomain, wildcardCertArn } = props;
    const prefix = upperFirst(subDomain || 'root');
    const fullDomain = [subDomain, topLevelDomain].filter((d) => !!d).join('.');

    const hostedZone = route53.HostedZone.fromLookup(
      scope,
      `${prefix}HostedZone`,
      {
        domainName: topLevelDomain,
        privateZone: false,
      },
    );

    const certificate = cert.Certificate.fromCertificateArn(
      scope,
      `${prefix}Certificate`,
      wildcardCertArn,
    );

    super(scope, `${prefix}Distribution`, {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
      },
      domainNames: [fullDomain],
      certificate,
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    new route53.ARecord(scope, `${prefix}CloudfrontAlias`, {
      recordName: fullDomain,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this),
      ),
      zone: hostedZone,
    });
  }
}
