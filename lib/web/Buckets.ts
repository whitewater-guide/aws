import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';
import { BucketDistribution } from './BucketDistribution';

export class Buckets {
  public readonly contentBucket: s3.Bucket;
  public readonly adminBucket: s3.Bucket;
  public readonly landingBucket: s3.Bucket;

  constructor(scope: cdk.Construct) {
    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const isDev = Config.get(scope, 'isDev');

    this.contentBucket = new s3.Bucket(scope, 'ContentBucket', {
      bucketName: `content.${topLevelDomain}`,
      lifecycleRules: [
        {
          enabled: true,
          prefix: 'temp/',
          expiration: cdk.Duration.days(1),
        },
      ],
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
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
    // Allow everyone read images from temp folder
    // this is the best way to allow uploader to see the preview
    // without messing with aws user identities
    this.contentBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.contentBucket.arnForObjects('temp/*')],
        principals: [new iam.AnyPrincipal()],
      }),
    );

    this.landingBucket = new s3.Bucket(scope, 'LandingBucket', {
      bucketName: topLevelDomain,
      publicReadAccess: true,
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });
    new BucketDistribution(scope, this.landingBucket);

    this.adminBucket = new s3.Bucket(scope, 'AdminBucket', {
      bucketName: `admin.${topLevelDomain}`,
      publicReadAccess: true,
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });
    new BucketDistribution(scope, this.adminBucket, 'admin');
  }
}
