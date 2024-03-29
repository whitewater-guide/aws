import { CfnOutput } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { Config } from '../config';

export interface BackupTaskDefinitionProps {
  postgresSecret: secretsmanager.ISecret;
}

export class BackupTaskDefinition extends ecs.FargateTaskDefinition {
  constructor(scope: Construct, props: BackupTaskDefinitionProps) {
    const { postgresSecret } = props;
    const crossAccount = Config.get(scope, 'crossAccount');

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
      command: ['/app/backup.sh'],
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

    // Allow restore task in dev deployment to pull backups from prod deployment
    if (crossAccount?.prodBackupsBucketName) {
      this.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['s3:ListBucket'],
          resources: [`arn:aws:s3:::${crossAccount.prodBackupsBucketName}`],
        }),
      );
      this.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: [`arn:aws:s3:::${crossAccount.prodBackupsBucketName}/*`],
        }),
      );
      new CfnOutput(this, 'TaskRoleOutput', {
        value: this.taskRole.roleArn,
      });
    }
  }
}
