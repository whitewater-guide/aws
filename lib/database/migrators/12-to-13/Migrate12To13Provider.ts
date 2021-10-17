import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda-nodejs';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';
import * as path from 'path';

import { Migrate12To13ResourceProps } from './types';

interface Migrate12To13ProviderProps extends Migrate12To13ResourceProps {
  taskDef: ecs.TaskDefinition;
}

export default class Migrate12To13Provider extends cdk.Construct {
  private readonly _provider: cr.Provider;

  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(
    scope: cdk.Construct,
    props: Migrate12To13ProviderProps,
  ) {
    const stack = cdk.Stack.of(scope);
    const id = 'M12t13Sngltn';
    const x =
      (stack.node.tryFindChild(id) as Migrate12To13Provider) ||
      new Migrate12To13Provider(stack, id, props);
    return x._provider.serviceToken;
  }

  constructor(
    scope: cdk.Construct,
    id: string,
    props: Migrate12To13ProviderProps,
  ) {
    super(scope, id);
    const { clusterArn, taskDefArn, taskDef } = props;

    const commonProps: lambda.NodejsFunctionProps = {
      entry: path.resolve(__dirname, 'lambda.ts'),
      bundling: {
        externalModules: ['aws-sdk'],
      },
      timeout: cdk.Duration.seconds(30),
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
      queryInterval: cdk.Duration.seconds(30),
      totalTimeout: cdk.Duration.hours(2),
      logRetention: logs.RetentionDays.ONE_DAY,
    });
  }
}
