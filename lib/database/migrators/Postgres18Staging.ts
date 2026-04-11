import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';

import type { DatabaseProps } from '../types';
import { POSTGRES18_STAGING_SECRET_NAME } from './constants';

export class Postgres18Staging {
  private readonly _instance: rds.DatabaseInstance;

  constructor(scope: Construct, { cluster }: DatabaseProps) {
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_18_2,
    });

    this._instance = new rds.DatabaseInstance(scope, 'Pg18Staging', {
      engine,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM,
      ),
      vpc: cluster.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publiclyAccessible: true,
      multiAz: false,
      databaseName: 'postgres',
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        secretName: POSTGRES18_STAGING_SECRET_NAME,
        excludeCharacters: ' =.,%+~^`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      cloudwatchLogsRetention: logs.RetentionDays.ONE_DAY,
      backupRetention: Duration.days(0),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      allocatedStorage: 50,
      maxAllocatedStorage: 100,
    });
    this._instance.connections.allowDefaultPortFromAnyIpv4();

    new CfnOutput(scope, 'Pg18StagingHost', {
      value: this._instance.dbInstanceEndpointAddress,
      description: 'PG18 staging public hostname',
    });
    new CfnOutput(scope, 'Pg18StagingSecretArn', {
      value: this._instance.secret?.secretArn ?? '',
      description: 'PG18 staging credentials secret ARN',
    });

    new cloudwatch.Alarm(scope, 'Pg18StagingHighCPU', {
      metric: this._instance.metricCPUUtilization(),
      threshold: 90,
      evaluationPeriods: 1,
    });
    new cloudwatch.Alarm(scope, 'Pg18StagingLowStorage', {
      metric: this._instance.metricFreeStorageSpace(),
      threshold: 1024 * 1024 * 1024 * 5,
      evaluationPeriods: 1,
    });
  }

  public get secret() {
    // biome-ignore lint/style/noNonNullAssertion: <secret is created>
    return this._instance.secret!;
  }

  public get host() {
    return this._instance.dbInstanceEndpointAddress;
  }

  public get port() {
    return this._instance.dbInstanceEndpointPort;
  }
}
