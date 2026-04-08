import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import Migrate13To18Provider from './Migrate13To18Provider';
import { Migrate13To18TaskDefinition } from './Migrate13To18TaskDefinition';
import { Migrate13To18Props, Migrate13To18ResourceProps } from './types';

/**
 * Migrate13To18 is a custom resource that does the following:
 * - Launches a Fargate ECS task that dumps all databases from PG13 and restores them to staging PG18
 */
export class Migrate13To18 extends Construct {
  constructor(scope: Construct, id: string, props: Migrate13To18Props) {
    super(scope, id);
    const { cluster, secrets } = props;

    const taskDef = new Migrate13To18TaskDefinition(this, { secrets });

    const properties: Migrate13To18ResourceProps = {
      taskDefArn: taskDef.taskDefinitionArn,
      clusterArn: cluster.clusterArn,
      subnets: cluster.vpc.privateSubnets.map((s) => s.subnetId),
    };

    new CustomResource(this, 'CRes', {
      serviceToken: Migrate13To18Provider.getOrCreate(this, {
        ...properties,
        taskDef,
      }),
      resourceType: 'Custom::Migrate13To18',
      properties,
    });
  }
}
