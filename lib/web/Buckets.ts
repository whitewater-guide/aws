import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';
import { v4 } from 'uuid';

import { Config } from '../config';
import { BucketDistribution } from './BucketDistribution';

export class Buckets {
  public readonly contentBucket: s3.Bucket;
  public readonly adminBucket: s3.Bucket;
  public readonly appBucket: s3.Bucket;
  public readonly landingBucket: s3.Bucket;
  public readonly backupsBucket: s3.Bucket;

  constructor(scope: Construct) {
    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const isDev = Config.get(scope, 'isDev');
    const crossAccount = Config.get(scope, 'crossAccount');

    this.contentBucket = new s3.Bucket(scope, 'ContentBucket', {
      bucketName: `content.${topLevelDomain}`,
      lifecycleRules: [
        {
          enabled: true,
          prefix: 'temp/',
          expiration: Duration.days(1),
        },
      ],
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
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
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });
    new BucketDistribution(scope, this.landingBucket);

    this.adminBucket = new s3.Bucket(scope, 'AdminBucket', {
      bucketName: `admin.${topLevelDomain}`,
      publicReadAccess: true,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });
    new BucketDistribution(scope, this.adminBucket, 'admin');

    // This bucket is used to serve .well-known for mobile apps
    // (apple-app-site-association for apple and assetlinks.json for android)
    this.appBucket = new s3.Bucket(scope, 'AppBucket', {
      bucketName: `app.${topLevelDomain}`,
      publicReadAccess: true,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });
    const appDistribution = new BucketDistribution(
      scope,
      this.appBucket,
      'app',
    );
    const appBucketDeployment = new s3deploy.BucketDeployment(
      scope,
      'AppDeploy',
      {
        sources: [s3deploy.Source.asset(path.resolve(__dirname, 'app'))],
        destinationBucket: this.appBucket,
        distribution: appDistribution,
      },
    );
    const aasa = '.well-known/apple-app-site-association';
    // IAM policy to allow the custom resource to modify the S3 object
    const policyStatement = new iam.PolicyStatement({
      actions: [
        's3:PutObject',
        's3:CopyObject',
        's3:GetObject',
        's3:DeleteObject',
      ],
      resources: [this.appBucket.arnForObjects(aasa)],
    });
    // Update apple-app-site-association content-type
    const aasaContentType = new cr.AwsCustomResource(
      scope,
      'AASAContentTypeChange',
      {
        policy: cr.AwsCustomResourcePolicy.fromStatements([policyStatement]),
        onUpdate: {
          service: 'S3',
          action: 'copyObject',
          parameters: {
            Bucket: `app.${topLevelDomain}`,
            CopySource: `app.${topLevelDomain}/${aasa}`,
            Key: aasa,
            MetadataDirective: 'REPLACE',
            ContentType: 'application/json',
            Metadata: { uuid: v4() },
          },
          physicalResourceId: cr.PhysicalResourceId.of(aasa),
        },
      },
    );
    aasaContentType.node.addDependency(appBucketDeployment);
    // verify with
    // curl -i https://app.whitewater.guide/.well-known/apple-app-site-association

    this.backupsBucket = new s3.Bucket(scope, 'BackupsBucket', {
      bucketName: `backups.${topLevelDomain}`,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(180),
        },
      ],
    });

    // Allow restore task in dev deployment to pull backups from prod deployment
    if (!isDev && crossAccount?.devBackupTaskRoleArn) {
      this.backupsBucket.grantRead(
        new iam.ArnPrincipal(crossAccount.devBackupTaskRoleArn),
      );
    }
  }
}
