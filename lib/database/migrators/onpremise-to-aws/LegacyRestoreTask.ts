import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface LegacyRestoreTaskProps {
  password: ecs.Secret;
  host: string;
}

/**
 * This task definition was used to migrate old (pre-AWS) backup into AWS RDS
 */
export class LegacyRestoreTask extends ecs.FargateTaskDefinition {
  constructor(scope: Construct, props: LegacyRestoreTaskProps) {
    const { password, host } = props;

    super(scope, 'LegacyRestoreTaskDef', { cpu: 1024, memoryLimitMiB: 2048 });

    this.addContainer('LegacyRestoreContainer', {
      image: ecs.ContainerImage.fromRegistry(
        'ghcr.io/whitewater-guide/pg_dump_restore:1.8.6',
      ),
      environment: {
        PGHOST: host,
        PGUSER: 'postgres',
      },
      secrets: {
        PGPASSWORD: password,
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'LegacyRestore',
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
      entryPoint: ['/app/restore_aws.sh'],
    });
  }
}
