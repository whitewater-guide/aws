import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as discovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export default class Cluster extends ecs.Cluster {
  constructor(scope: Construct, id: string, vpc: ec2.Vpc) {
    super(scope, id, {
      vpc,
      defaultCloudMapNamespace: {
        name: 'local',
        type: discovery.NamespaceType.DNS_PRIVATE,
      },
    });
  }
}
