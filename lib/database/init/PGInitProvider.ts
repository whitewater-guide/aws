import { Duration, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

interface PGInitProviderProps {
  vpc: ec2.IVpc;
  isDev?: boolean;
}

export default class PGInitProvider extends Construct {
  private readonly _provider: cr.Provider;

  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: Construct, props: PGInitProviderProps) {
    const stack = Stack.of(scope);
    const id = 'com.amazonaws.custom-resources.pginit-provider';
    const x =
      (stack.node.tryFindChild(id) as PGInitProvider) ||
      new PGInitProvider(stack, id, props);
    return x._provider.serviceToken;
  }

  constructor(scope: Construct, id: string, props: PGInitProviderProps) {
    super(scope, id);
    const { vpc } = props;

    this._provider = new cr.Provider(this, 'PGInitProvider', {
      onEventHandler: new lambda.NodejsFunction(this, 'PGInitLambda', {
        entry: path.resolve(__dirname, 'lambda.ts'),
        handler: 'onEvent',
        bundling: {
          externalModules: ['aws-sdk', 'pg-native'],
        },
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE },
        initialPolicy: [
          new iam.PolicyStatement({
            actions: [
              'secretsmanager:GetSecretValue',
              'secretsmanager:DescribeSecret',
            ],
            resources: ['*'],
          }),
        ],
        timeout: Duration.minutes(15),
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
      logRetention: logs.RetentionDays.ONE_DAY,
    });
  }
}
