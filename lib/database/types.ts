import * as ecs from 'aws-cdk-lib/aws-ecs';

export interface DatabaseProps {
  cluster: ecs.Cluster;
}
