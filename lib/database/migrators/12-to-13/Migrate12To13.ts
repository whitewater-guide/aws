import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import Migrate12To13Provider from './Migrate12To13Provider';
import { Migrate12To13TaskDefinition } from './Migrate12To13TaskDefinition';
import { Postgres13Temp } from './Postgres13Temp';
import { Migrate12To13Props, Migrate12To13ResourceProps } from './types';

/**
 * Migrate12To13 is custom resource that does following:
 * - Launches Fargate ECS task that migrates data from postgres 12 to postgres 13 and sets up partitioning in pg13
 */
export class Migrate12To13 extends Construct {
  constructor(scope: Construct, id: string, props: Migrate12To13Props) {
    super(scope, id);
    const { cluster, secrets } = props;

    const pg13temp = new Postgres13Temp(this, props);

    const taskDef = new Migrate12To13TaskDefinition(this, {
      secrets: {
        ...secrets,
        pg13Temp: pg13temp.secret,
      },
    });

    const properties: Migrate12To13ResourceProps = {
      taskDefArn: taskDef.taskDefinitionArn,
      clusterArn: cluster.clusterArn,
      subnets: cluster.vpc.privateSubnets.map((s) => s.subnetId),
    };

    new CustomResource(this, 'CRes', {
      serviceToken: Migrate12To13Provider.getOrCreate(this, {
        ...properties,
        taskDef,
      }),
      resourceType: 'Custom::Migrate12To13',
      properties,
    });
  }
}
