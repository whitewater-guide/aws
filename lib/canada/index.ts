import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

import { Quebec2Downloader } from './Quebec2Downloader';

/**
 * Stack deployed in `ca-central-1` to work around some geofencing for Gorge upstreams in Canada
 */
export class CanadaStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const prefix = 'quebec2';

    const bucket = new s3.Bucket(this, 'Bucket', {
      publicReadAccess: true,
      blockPublicAccess: {
        blockPublicPolicy: false,
        blockPublicAcls: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      lifecycleRules: [
        {
          enabled: true,
          prefix,
          expiration: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new Quebec2Downloader(this, { bucket, prefix });

    new CfnOutput(this, 'Quebec2BaseURL', {
      value: `${bucket.bucketWebsiteUrl}/${prefix}`,
      description: 'Base URL quebec2 files downloaded to s3',
    });
  }
}
