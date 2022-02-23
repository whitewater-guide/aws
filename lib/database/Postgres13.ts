import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

import { Config } from '../config';
import { POSTGRES_SECRET_NAME } from './constants';
import { DatabaseProps } from './types';

export class Postgres13 {
  private readonly _instance: rds.DatabaseInstance;
  private readonly _scope: Construct;

  constructor(scope: Construct, { cluster }: DatabaseProps) {
    const isDev = Config.get(scope, 'isDev');
    this._scope = scope;

    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_13_4,
    });

    const parameterGroup = new rds.ParameterGroup(scope, 'PG13Params', {
      engine,
      parameters: {
        shared_preload_libraries: 'pg_cron',
      },
    });

    this._instance = new rds.DatabaseInstance(scope, 'Pg13', {
      engine,
      parameterGroup,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc: cluster.vpc,
      multiAz: false,
      databaseName: 'postgres',
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        secretName: POSTGRES_SECRET_NAME,
        excludeCharacters: ' =.,%+~^`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      cloudwatchLogsRetention: logs.RetentionDays.ONE_DAY,
      backupRetention: isDev ? Duration.days(0) : Duration.days(3),
      deleteAutomatedBackups: isDev,
      deletionProtection: !isDev,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.SNAPSHOT,
      allocatedStorage: 20,
      maxAllocatedStorage: isDev ? 50 : 100,
    });
    // we're in private subnet
    this._instance.connections.allowDefaultPortFromAnyIpv4();
    // Add alarm for high CPU
    new cloudwatch.Alarm(scope, 'Pg13HighCPU', {
      metric: this._instance.metricCPUUtilization(),
      threshold: 90,
      evaluationPeriods: 1,
    });
    new cloudwatch.Alarm(scope, 'Pg13LowStorage', {
      metric: this._instance.metricFreeStorageSpace(),
      threshold: 1024 * 1024 * 1024 * 5,
      evaluationPeriods: 1,
    });

    // Enable service discovery
    if (cluster.defaultCloudMapNamespace) {
      const service = new cloudmap.Service(this._scope, 'PgCloudmapService', {
        namespace: cluster.defaultCloudMapNamespace,
        name: 'postgres',
        dnsRecordType: cloudmap.DnsRecordType.CNAME,
      });
      service.registerCnameInstance('PgCloudmapInstance', {
        instanceCname: this._instance.dbInstanceEndpointAddress,
      });
    }
  }

  public get secret() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this._instance.secret!;
  }

  public get host() {
    return this._instance.dbInstanceEndpointAddress;
  }

  public get port() {
    return this._instance.dbInstanceEndpointPort;
  }
}
