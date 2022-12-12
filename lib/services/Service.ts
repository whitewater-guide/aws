import { Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import upperFirst from 'lodash/upperFirst';
import { Required } from 'utility-types';

import AppTags from '../AppTags';
import { logRouter, lokiLogDriver } from './utils';

export enum LogDriver {
  GRAFANA,
  AWS,
}

export interface LoggingConfig {
  driver: LogDriver;
  useJson?: boolean;
  level?: string;
}

export interface ServiceProps {
  isDev?: boolean;
  name: string;
  cluster: ecs.Cluster;
  image: string;

  environment?: { [key: string]: string };
  secrets?: { [key: string]: ecs.Secret };
  logging?: LoggingConfig;
  command?: string[];

  port: number;
  healthCheck: Required<elbv2.HealthCheck, 'path'>;

  cpu?: number;
  memory?: number;
  desiredCount?: number;
}

export class Service {
  private readonly _loadBalancerTargets: ecs.IEcsLoadBalancerTarget[];
  private readonly _taskDefinition: ecs.FargateTaskDefinition;
  private readonly _healthCheck: Required<elbv2.HealthCheck, 'path'>;
  private readonly _port: number;
  private readonly _service: ecs.FargateService;
  protected readonly _scope: Construct;

  constructor(scope: Construct, props: ServiceProps) {
    const {
      isDev,
      name,
      image,
      secrets,
      cluster,
      port,
      cpu,
      memory,
      desiredCount = 1,
      logging,
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

    let logDriver: ecs.LogDriver | undefined;
    switch (logging?.driver) {
      case LogDriver.AWS:
        logDriver = new ecs.AwsLogDriver({
          streamPrefix: prefix,
          logRetention: isDev
            ? logs.RetentionDays.ONE_DAY
            : logs.RetentionDays.ONE_WEEK,
        });
        break;
      case LogDriver.GRAFANA:
        logDriver = lokiLogDriver(name, { useJson: logging.useJson });
        break;
    }

    const container = this._taskDefinition.addContainer(`${prefix}Container`, {
      essential: true,
      image: ecs.ContainerImage.fromRegistry(image),
      environment: {
        ...props.environment,
        LOG_LEVEL: logging?.level ?? 'INFO',
      },
      secrets,
      logging: logDriver,
      command: props.command,
    });
    if (logging?.driver === LogDriver.GRAFANA) {
      this._taskDefinition.addFirelensLogRouter('LogRouter', logRouter());
    }

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
    Tags.of(this._service).add(...AppTags.DesiredCount(desiredCount));

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
        protocol: elbv2.Protocol.HTTP,
        port: this._port.toString(10),
        healthyHttpCodes: '200-399',
        ...this._healthCheck,
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
