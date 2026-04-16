import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

import { SSM } from '../SSM';
import { Api } from './Api';
import { LogDriver, Service } from './Service';

interface Props {
  postgresSecret: secretsmanager.ISecret;
  cluster: ecs.Cluster;
}

export class Gorge extends Service {
  public static PORT = 7080;

  constructor(scope: Construct, props: Props) {
    const { cluster, postgresSecret } = props;

    const fileSystem = new efs.FileSystem(scope, 'GorgeCache', {
      vpc: cluster.vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const accessPoint = fileSystem.addAccessPoint('GorgeCacheAP', {
      path: '/gorge',
      createAcl: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      posixUser: { gid: '1000', uid: '1000' },
    });

    super(scope, {
      cluster,
      healthCheck: { path: '/version' },
      image: 'ghcr.io/whitewater-guide/gorge:3.14.3',
      name: 'gorge',
      // memory: 2048,
      // cpu: 512,
      port: Gorge.PORT,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      command: [
        '--cache',
        'bbolt',
        '--bbolt-path',
        '/data/bbolt-cache.db',
        '--pg-host',
        'postgres.local',
        '--pg-db',
        'gorge',
        '--db-chunk-size',
        '1000',
        '--log-level',
        // Warning! When set to debug, this produces hellish amount of logs, which will cost you some $$$ in AWS CloudWatch
        'debug',
        '--hooks-health-url',
        `http://api.local:${Api.PORT}/gorge/health`,
        '--hooks-health-headers',
        'x-api-key: $GORGE_HEALTH_KEY', // this env is evaluated by gorge during runtime, not by docker!
      ],
      environment: {
        // Deployed in ca-central-1 region in Canada stack
        QUEBEC2_MIRROR:
          'https://canada-bucket83908e77-euxaksjhhzkl.s3.ca-central-1.amazonaws.com/quebec2',
      },
      secrets: {
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          postgresSecret,
          'password',
        ),
        GORGE_HEALTH_KEY: SSM.secret(scope, SSM.GORGE_HEALTH_KEY),
        NVE_API_KEY: SSM.secret(scope, SSM.GORGE_NVE_API_KEY),
      },
      logging: {
        driver: LogDriver.GRAFANA,
      },
      volumes: [
        {
          name: 'gorge-cache',
          containerPath: '/data',
          efsVolumeConfiguration: {
            fileSystemId: fileSystem.fileSystemId,
            transitEncryption: 'ENABLED',
            authorizationConfig: {
              accessPointId: accessPoint.accessPointId,
            },
          },
        },
      ],
    });

    fileSystem.connections.allowDefaultPortFrom(this.connections);

    const alertEmail = process.env.ALARM_EMAIL;
    if (alertEmail) {
      const alertTopic = new sns.Topic(scope, 'GorgeCacheAlertTopic');
      alertTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(alertEmail),
      );

      const alarm = new cloudwatch.Alarm(scope, 'GorgeCacheSizeAlarm', {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/EFS',
          metricName: 'StorageBytes',
          dimensionsMap: {
            FileSystemId: fileSystem.fileSystemId,
            StorageClass: 'Total',
          },
          period: cdk.Duration.minutes(15),
          statistic: 'Maximum',
        }),
        threshold: 100 * 1024 * 1024, // 100 MB in bytes
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: 'Gorge bbolt cache on EFS has exceeded 100 MB',
      });
      alarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
    }
  }
}
