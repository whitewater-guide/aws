import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { Config } from '../../../config';

interface Props {
  secrets: {
    pg12: secretsmanager.ISecret;
    pg13Temp: secretsmanager.ISecret;
    pg13: secretsmanager.ISecret;
  };
}

/**
 * This task is launched by lambda in custom resource to migrate data from pg12 to pg13
 */
export class Migrate12To13TaskDefinition extends ecs.FargateTaskDefinition {
  constructor(scope: Construct, { secrets }: Props) {
    super(scope, 'TaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const backupsBucket = `backups.${topLevelDomain}`;
    const backupsPrefix = 'migration12_to_13/';

    this.addContainer('Container', {
      image: ecs.ContainerImage.fromAsset(__dirname),
      environment: {
        S3_BUCKET: backupsBucket,
        S3_PREFIX: backupsPrefix,
      },
      secrets: {
        PG12_HOST: ecs.Secret.fromSecretsManager(secrets.pg12, 'host'),
        PG12_PASSWORD: ecs.Secret.fromSecretsManager(secrets.pg12, 'password'),
        PG13TEMP_HOST: ecs.Secret.fromSecretsManager(secrets.pg13Temp, 'host'),
        PG13TEMP_PASSWORD: ecs.Secret.fromSecretsManager(
          secrets.pg13Temp,
          'password',
        ),
        PG13_HOST: ecs.Secret.fromSecretsManager(secrets.pg13, 'host'),
        PG13_PASSWORD: ecs.Secret.fromSecretsManager(secrets.pg13, 'password'),
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'Migrate12To13',
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
    });

    // This allows task to upload backups
    this.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject*'],
        resources: [`arn:aws:s3:::${backupsBucket}/${backupsPrefix}*`],
      }),
    );
  }
}
