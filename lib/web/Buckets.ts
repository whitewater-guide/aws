import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import { AutoDeleteBucket } from '@mobileposse/auto-delete-bucket';

import { Config } from '../config';
import { BucketDistribution } from './BucketDistribution';

export class Buckets {
  public readonly contentBucket: s3.Bucket;
  public readonly adminBucket: s3.Bucket;
  public readonly landingBucket: s3.Bucket;

  constructor(scope: cdk.Construct) {
    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const isDev = Config.get(scope, 'isDev');

    const BucketClass = isDev ? AutoDeleteBucket : s3.Bucket;

    this.contentBucket = new BucketClass(scope, 'ContentBucket', {
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
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          // We need to access location from JS
          exposedHeaders: ['Location'],
        },
      ],
    });

    this.landingBucket = new BucketClass(scope, 'LandingBucket', {
      bucketName: topLevelDomain,
      publicReadAccess: true,
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
    new BucketDistribution(scope, this.landingBucket);

    this.adminBucket = new BucketClass(scope, 'AdminBucket', {
      bucketName: `admin.${topLevelDomain}`,
      publicReadAccess: true,
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
    new BucketDistribution(scope, this.adminBucket, 'admin');
  }
}
