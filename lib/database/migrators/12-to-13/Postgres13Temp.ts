import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

import { Config } from '../../../config';
import { DatabaseProps } from '../../types';

export class Postgres13Temp {
  private readonly _instance: rds.DatabaseInstance;
  private readonly _scope: Construct;

  constructor(scope: Construct, { cluster }: DatabaseProps) {
    const isDev = Config.get(scope, 'isDev');
    this._scope = scope;

    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_13_4,
    });

    const parameterGroup = new rds.ParameterGroup(scope, 'PG13TempParams', {
      engine,
      parameters: {
        shared_preload_libraries: 'pg_cron',
      },
    });

    this._instance = new rds.DatabaseInstance(scope, 'Pg13Temp', {
      engine,
      parameterGroup,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.XLARGE,
      ),
      vpc: cluster.vpc,
      multiAz: false,
      databaseName: 'postgres',
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        excludeCharacters: ' =.,%+~^`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      cloudwatchLogsRetention: logs.RetentionDays.ONE_DAY,
      backupRetention: Duration.days(0),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // we're in private subnet
    this._instance.connections.allowDefaultPortFromAnyIpv4();
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
