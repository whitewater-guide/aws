import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as cdk from '@aws-cdk/core';
import { upperFirst } from 'lodash';

export interface ServiceProps {
  isDev?: boolean;
  name: string;
  cluster: ecs.Cluster;
  image: string;

  environment?: { [key: string]: string };
  secrets?: { [key: string]: ecs.Secret };
  enableLogging?: boolean;
  command?: string[];

  port: number;
  healthCheck: string;

  cpu?: number;
  memory?: number;
  desiredCount?: number;
}

export class Service {
  private readonly _loadBalancerTargets: ecs.IEcsLoadBalancerTarget[];
  private readonly _taskDefinition: ecs.FargateTaskDefinition;
  private readonly _healthCheck: string;
  private readonly _port: number;
  private readonly _service: ecs.FargateService;
  protected readonly _scope: cdk.Construct;

  constructor(scope: cdk.Construct, props: ServiceProps) {
    const {
      isDev,
      name,
      image,
      environment,
      secrets,
      cluster,
      port,
      cpu,
      memory,
      desiredCount,
    } = props;
    this._scope = scope;
    this._healthCheck = props.healthCheck;
    this._port = port;
    const prefix = upperFirst(name);

    this._taskDefinition = new ecs.FargateTaskDefinition(
      scope,
      `${prefix}TaskDef`,
      { cpu, memoryLimitMiB: memory },
    );

    const container = this._taskDefinition.addContainer(`${prefix}Container`, {
      image: ecs.ContainerImage.fromRegistry(image),
      environment,
      secrets,
      logging: props.enableLogging
        ? new ecs.AwsLogDriver({
            streamPrefix: prefix,
            logRetention: isDev
              ? logs.RetentionDays.ONE_DAY
              : logs.RetentionDays.ONE_WEEK,
          })
        : undefined,
      command: props.command,
    });

    container.addPortMappings({
      containerPort: port,
      hostPort: port,
      protocol: ecs.Protocol.TCP,
    });

    this._service = new ecs.FargateService(scope, `${prefix}Service`, {
      cluster,
      taskDefinition: this._taskDefinition,
      vpcSubnets: {
        subnets: cluster.vpc.privateSubnets,
      },
      cloudMapOptions: {
        name,
      },
      desiredCount,
    });

    this._loadBalancerTargets = [
      this._service.loadBalancerTarget({
        containerName: container.containerName,
        containerPort: port,
      }),
    ];
  }

  public get connections(): ec2.Connections {
    return this._service.connections;
  }

  public get listenerTargetProps(): elbv2.AddApplicationTargetsProps {
    return {
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: this._loadBalancerTargets,
      healthCheck: {
        path: this._healthCheck,
        protocol: elbv2.Protocol.HTTP,
        port: this._port.toString(10),
      },
    };
  }

  public addToTaskRolePolicy(statements: iam.PolicyStatement[]) {
    statements.forEach((stmt) =>
      this._taskDefinition.addToTaskRolePolicy(stmt),
    );
  }

  public get taskRole() {
    return this._taskDefinition.taskRole;
  }
}
