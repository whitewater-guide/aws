import * as path from 'node:path';

import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';

interface Quebec2DownloaderProps {
  bucket: s3.Bucket;
  prefix: string;
}

/**
 * Downloads geofenced source files from a quebec2 data source and caches them in S3
 */
export class Quebec2Downloader extends Construct {
  constructor(scope: Construct, { bucket, prefix }: Quebec2DownloaderProps) {
    super(scope, 'Quebec2');

    const fn = new nodejs.NodejsFunction(this, 'DownloaderFn', {
      entry: path.resolve(import.meta.dirname, 'lambda/index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.minutes(3),
      logRetention: logs.RetentionDays.ONE_DAY,
      environment: {
        S3_BUCKET: bucket.bucketName,
        S3_PREFIX: prefix,
      },
    });

    bucket.grantWrite(fn);

    new scheduler.Schedule(this, 'Schedule', {
      schedule: scheduler.ScheduleExpression.cron({
        minute: '49',
      }),
      // add some jitter
      timeWindow: scheduler.TimeWindow.flexible(Duration.minutes(5)),
      target: new targets.LambdaInvoke(fn, {
        retryAttempts: 0,
      }),
    });
  }
}
