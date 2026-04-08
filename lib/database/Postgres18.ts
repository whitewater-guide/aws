import { ArnFormat, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

import { Config } from '../config';
import { DatabaseProps } from './types';

export class Postgres18 {
  private readonly _instance: rds.DatabaseInstanceFromSnapshot;
  private readonly _scope: Construct;

  constructor(scope: Construct, { cluster }: DatabaseProps) {
    const isDev = Config.get(scope, 'isDev');
    this._scope = scope;

    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_18_2,
    });

    const parameterGroup = new rds.ParameterGroup(scope, 'PG18Params', {
      engine,
      parameters: {
        shared_preload_libraries: 'pg_cron',
        'rds.force_ssl': '0',
      },
    });

    this._instance = new rds.DatabaseInstanceFromSnapshot(scope, 'Pg18', {
      engine,
      parameterGroup,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc: cluster.vpc,
      multiAz: false,
      credentials: rds.SnapshotCredentials.fromGeneratedSecret('postgres', {
        excludeCharacters: ' =.,%+~^`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      cloudwatchLogsRetention: logs.RetentionDays.ONE_DAY,
      backupRetention: isDev ? Duration.days(0) : Duration.days(3),
      deleteAutomatedBackups: isDev,
      deletionProtection: !isDev,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.SNAPSHOT,
      allocatedStorage: 40,
      maxAllocatedStorage: 150,
      snapshotIdentifier: Stack.of(scope).formatArn({
        service: 'rds',
        resource: 'snapshot',
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        resourceName: 'fromv13',
      }),
    });
    this._instance.connections.allowDefaultPortFromAnyIpv4();

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

    new cloudwatch.Alarm(scope, 'Pg18HighCPU', {
      metric: this._instance.metricCPUUtilization(),
      threshold: 90,
      evaluationPeriods: 1,
    });
    new cloudwatch.Alarm(scope, 'Pg18LowStorage', {
      metric: this._instance.metricFreeStorageSpace(),
      threshold: 1024 * 1024 * 1024 * 5,
      evaluationPeriods: 1,
    });
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
