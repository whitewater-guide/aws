import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda-nodejs';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';
import * as path from 'path';

interface PGInitProviderProps {
  vpc: ec2.IVpc;
  isDev?: boolean;
  postgresSecretArn: string;
}

export default class PGInitProvider extends cdk.Construct {
  private readonly _provider: cr.Provider;

  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: cdk.Construct, props: PGInitProviderProps) {
    const stack = cdk.Stack.of(scope);
    const id = 'com.amazonaws.cdk.custom-resources.pginit-provider';
    const x =
      (stack.node.tryFindChild(id) as PGInitProvider) ||
      new PGInitProvider(stack, id, props);
    return x._provider.serviceToken;
  }

  constructor(scope: cdk.Construct, id: string, props: PGInitProviderProps) {
    super(scope, id);
    const { postgresSecretArn, vpc } = props;
    this._provider = new cr.Provider(this, 'PGInitProvider', {
      onEventHandler: new lambda.NodejsFunction(this, 'PGInitLambda', {
        entry: path.resolve(__dirname, 'lambda.ts'),
        handler: 'onEvent',
        externalModules: ['aws-sdk', 'pg-native'],
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE },
        initialPolicy: [
          new iam.PolicyStatement({
            actions: [
              'secretsmanager:GetSecretValue',
              'secretsmanager:DescribeSecret',
            ],
            resources: [postgresSecretArn],
          }),
        ],
        timeout: cdk.Duration.minutes(15),
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
      logRetention: logs.RetentionDays.ONE_DAY,
    });
  }
}
