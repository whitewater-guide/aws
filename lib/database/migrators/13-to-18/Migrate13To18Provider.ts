import * as path from 'node:path';
import { Duration, Stack } from 'aws-cdk-lib';
import type * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

import type { Migrate13To18ResourceProps } from './types';

interface Migrate13To18ProviderProps extends Migrate13To18ResourceProps {
  taskDef: ecs.TaskDefinition;
}

export default class Migrate13To18Provider extends Construct {
  private readonly _provider: cr.Provider;

  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(
    scope: Construct,
    props: Migrate13To18ProviderProps,
  ) {
    const stack = Stack.of(scope);
    const id = 'M13t18Sngltn';
    const x =
      (stack.node.tryFindChild(id) as Migrate13To18Provider) ||
      new Migrate13To18Provider(stack, id, props);
    return x._provider.serviceToken;
  }

  constructor(scope: Construct, id: string, props: Migrate13To18ProviderProps) {
    super(scope, id);
    const { clusterArn, taskDefArn, taskDef } = props;

    const commonProps: lambda.NodejsFunctionProps = {
      entry: path.resolve(import.meta.dirname, 'lambda.ts'),
      bundling: {
        externalModules: ['aws-sdk'],
      },
      timeout: Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_DAY,
    };

    const onEventHandler = new lambda.NodejsFunction(this, 'EventHandler', {
      ...commonProps,
      handler: 'onEvent',
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['ecs:RunTask'],
          resources: [taskDefArn],
          conditions: {
            ArnEquals: { 'ecs:cluster': clusterArn },
          },
        }),
      ],
    });
    taskDef.executionRole?.grantPassRole(onEventHandler.grantPrincipal);
    taskDef.taskRole?.grantPassRole(onEventHandler.grantPrincipal);

    const isCompleteHandler = new lambda.NodejsFunction(
      this,
      'CompleteAwaiter',
      {
        ...commonProps,
        handler: 'isComplete',
        initialPolicy: [
          new iam.PolicyStatement({
            actions: ['ecs:DescribeTasks'],
            resources: ['*'],
            conditions: {
              ArnEquals: { 'ecs:cluster': clusterArn },
            },
          }),
        ],
      },
    );

    this._provider = new cr.Provider(this, 'Provider', {
      onEventHandler,
      isCompleteHandler,
      queryInterval: Duration.seconds(30),
      totalTimeout: Duration.hours(3),
      logRetention: logs.RetentionDays.ONE_DAY,
    });
  }
}
