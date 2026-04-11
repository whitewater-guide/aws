import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

import { Config } from '../../../config';

interface Props {
  secrets: {
    pg13: secretsmanager.ISecret;
    pg18: secretsmanager.ISecret;
  };
}

/**
 * This task is launched by lambda in custom resource to migrate data from pg13 to pg18
 */
export class Migrate13To18TaskDefinition extends ecs.FargateTaskDefinition {
  constructor(scope: Construct, { secrets }: Props) {
    super(scope, 'TaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      ephemeralStorageGiB: 50,
    });

    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const backupsBucket = `backups.${topLevelDomain}`;

    this.addContainer('Container', {
      image: ecs.ContainerImage.fromAsset(import.meta.dirname, {
        platform: Platform.LINUX_AMD64,
      }),
      environment: {
        S3_BUCKET: backupsBucket,
        S3_PREFIX: 'v3/',
      },
      secrets: {
        PG13_HOST: ecs.Secret.fromSecretsManager(secrets.pg13, 'host'),
        PG13_PASSWORD: ecs.Secret.fromSecretsManager(secrets.pg13, 'password'),
        PG18_HOST: ecs.Secret.fromSecretsManager(secrets.pg18, 'host'),
        PG18_PASSWORD: ecs.Secret.fromSecretsManager(secrets.pg18, 'password'),
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'Migrate13To18',
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
    });

    this.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [`arn:aws:s3:::${backupsBucket}`],
      }),
    );
    this.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject*'],
        resources: [`arn:aws:s3:::${backupsBucket}/*`],
      }),
    );
  }
}
