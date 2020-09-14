import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as discovery from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';

export default class Cluster extends ecs.Cluster {
  constructor(scope: cdk.Construct, id: string, vpc: ec2.Vpc) {
    super(scope, id, {
      vpc,
      defaultCloudMapNamespace: {
        name: 'local',
        type: discovery.NamespaceType.DNS_PRIVATE,
      },
    });
  }
}
