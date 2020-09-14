import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';

import { RootProps } from '../types';
import { BucketDistribution } from './BucketDistribution';

export class Buckets {
  public readonly contentBucket: s3.Bucket;
  public readonly adminBucket: s3.Bucket;
  public readonly landingBucket: s3.Bucket;

  constructor(scope: cdk.Construct, props: RootProps) {
    const { topLevelDomain } = props;

    this.contentBucket = new s3.Bucket(scope, 'ContentBucket', {
      bucketName: `content.${topLevelDomain}`,
      // Use PresignedPostPolicy to add content
      // Use cloudfront to access content
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          enabled: true,
          prefix: 'temp/',
          expiration: cdk.Duration.days(14),
        },
      ],
      removalPolicy: props.isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    this.landingBucket = new s3.Bucket(scope, 'LandingBucket', {
      bucketName: topLevelDomain,
      publicReadAccess: true,
      removalPolicy: props.isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
    new BucketDistribution(scope, this.landingBucket, undefined, props);

    this.adminBucket = new s3.Bucket(scope, 'AdminBucket', {
      bucketName: `admin.${topLevelDomain}`,
      publicReadAccess: true,
      removalPolicy: props.isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
    new BucketDistribution(scope, this.landingBucket, 'admin', props);
  }
}
