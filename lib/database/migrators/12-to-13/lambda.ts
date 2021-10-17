import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';
import AWS from 'aws-sdk';
import { v4 } from 'uuid';

import { Migrate12To13ResourceProps } from './types';

interface CreatePayload {
  TaskArn: string;
}

export async function onEvent(
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceResponse> {
  if (event.RequestType !== 'Create') {
    return {
      Status: 'SUCCESS',
      LogicalResourceId: event.LogicalResourceId,
      PhysicalResourceId: event.PhysicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
    };
  }

  // When creating, generate unique id
  const PhysicalResourceId = 'Migrate12To13X' + v4().replace(/-/g, '');
  const props = event.ResourceProperties as any as Migrate12To13ResourceProps;
  const ecs = new AWS.ECS();

  const { failures, tasks } = await ecs
    .runTask({
      taskDefinition: props.taskDefArn,
      cluster: props.clusterArn,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: props.subnets,
        },
      },
      startedBy: PhysicalResourceId,
    })
    .promise();

  const TaskArn = tasks?.[0].taskArn;

  if (failures?.length || !TaskArn) {
    console.error('task failed', failures);
    return {
      Status: 'FAILED',
      Reason: 'Task creation failed',
      LogicalResourceId: event.LogicalResourceId,
      PhysicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
    };
  }

  const Data: CreatePayload = { TaskArn };

  return {
    Status: 'SUCCESS',
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    Data,
  };
}

type IsCompleteEvent = CloudFormationCustomResourceEvent & {
  Data: CreatePayload;
};

export async function isComplete(
  event: IsCompleteEvent,
): Promise<{ IsComplete: boolean }> {
  console.info({ event });

  if (event.RequestType !== 'Create') {
    return { IsComplete: true };
  }

  const props = event.ResourceProperties as any as Migrate12To13ResourceProps;

  const ecs = new AWS.ECS();

  const { tasks } = await ecs
    .describeTasks({
      cluster: props.clusterArn,
      tasks: [event.Data.TaskArn],
    })
    .promise();

  console.info(JSON.stringify({ tasks }));

  // If an error is thrown, the framework will submit a "FAILED" response to AWS CloudFormation
  if (tasks?.length !== 1) {
    throw new Error('should have exactly one task');
  }
  const task = tasks[0];
  if (task.containers?.length !== 1) {
    throw new Error('task should have exactly one container');
  }
  const container = task.containers[0];
  if (
    task.lastStatus === 'STOPPED' &&
    task.stopCode !== 'EssentialContainerExited'
  ) {
    throw new Error(
      `Task stopped with code '${task.stopCode}': ${task.stoppedReason}`,
    );
  }
  if (container.lastStatus === 'STOPPED' && container.exitCode !== 0) {
    throw new Error(`container exited with code ${container.exitCode}`);
  }

  return {
    IsComplete: task.lastStatus === 'STOPPED',
  };
}
