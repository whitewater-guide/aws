import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';

export interface BackupTaskDefinitionProps {
  postgresSecret: secretsmanager.ISecret;
}

export class BackupTaskDefinition extends ecs.FargateTaskDefinition {
  constructor(scope: cdk.Construct, props: BackupTaskDefinitionProps) {
    const { postgresSecret } = props;

    super(scope, 'BackupTaskDef', { cpu: 1024, memoryLimitMiB: 2048 });

    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const backupsBucket = `backups.${topLevelDomain}`;

    this.addContainer('BackupContainer', {
      image: ecs.ContainerImage.fromRegistry(
        'ghcr.io/whitewater-guide/pg_dump_restore:3.6.1',
      ),
      environment: {
        PGUSER: 'postgres',
        S3_BUCKET: backupsBucket,
        S3_PREFIX: 'v3/',
      },
      secrets: {
        PGHOST: ecs.Secret.fromSecretsManager(postgresSecret, 'host'),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresSecret,
          'password',
        ),
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'Backup',
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
      entryPoint: ['/app/backup.sh'],
    });

    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [`arn:aws:s3:::${backupsBucket}`],
      }),
    );
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`arn:aws:s3:::${backupsBucket}/*`],
      }),
    );
  }
}
