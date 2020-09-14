import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as rds from '@aws-cdk/aws-rds';
import * as cloudmap from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';

import { DatabaseProps } from './types';

export class Postgres {
  private readonly _instance: rds.DatabaseInstance;
  private readonly _scope: cdk.Construct;

  constructor(scope: cdk.Construct, props: DatabaseProps) {
    const { cluster, isDev } = props;
    this._scope = scope;

    this._instance = new rds.DatabaseInstance(scope, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_12_3,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc: cluster.vpc,
      multiAz: false,
      masterUsername: 'postgres',
      databaseName: 'postgres',
      backupRetention: isDev ? cdk.Duration.days(0) : cdk.Duration.days(7),
      deleteAutomatedBackups: isDev,
      deletionProtection: !isDev,
      removalPolicy: isDev
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.SNAPSHOT,
    });
    // we're in private subnet
    this._instance.connections.allowDefaultPortFromAnyIpv4();
    // Add alarm for high CPU
    new cloudwatch.Alarm(scope, 'PostgresHighCPU', {
      metric: this._instance.metricCPUUtilization(),
      threshold: 90,
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
