import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';

export interface PGRestoreTaskProps {
  postgresSecret: secretsmanager.ISecret;
}

export class BackupTaskDefinition extends ecs.FargateTaskDefinition {
  constructor(scope: cdk.Construct, props: PGRestoreTaskProps) {
    const { postgresSecret } = props;

    super(scope, 'BackupTaskDef', { cpu: 1024, memoryLimitMiB: 2048 });

    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const backupsBucket = `backups.${topLevelDomain}`;

    this.addContainer('BackupContainer', {
      image: ecs.ContainerImage.fromRegistry(
        'ghcr.io/whitewater-guide/pg_dump_restore:2.0.6',
      ),
      environment: {
        PGUSER: 'postgres',
        S3_BUCKET: backupsBucket,
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
