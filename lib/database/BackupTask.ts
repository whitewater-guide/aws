import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';

import { Config } from '../config';

export interface PGRestoreTaskProps {
  password: ecs.Secret;
  host: string;
}

export class BackupTask extends ecs.FargateTaskDefinition {
  constructor(scope: cdk.Construct, props: PGRestoreTaskProps) {
    const { password, host } = props;

    super(scope, 'BackupTaskDef', { cpu: 1024, memoryLimitMiB: 2048 });

    const topLevelDomain = Config.get(scope, 'topLevelDomain');
    const backupsBucket = `backups.${topLevelDomain}`;

    this.addContainer('BackupContainer', {
      image: ecs.ContainerImage.fromRegistry(
        'ghcr.io/whitewater-guide/pg_dump_restore:2.0.6',
      ),
      environment: {
        PGHOST: host,
        PGUSER: 'postgres',
        S3_BUCKET: backupsBucket,
      },
      secrets: {
        POSTGRES_PASSWORD: password,
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
