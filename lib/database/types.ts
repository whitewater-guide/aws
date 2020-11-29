import * as ecs from '@aws-cdk/aws-ecs';

export interface DatabaseProps {
  cluster: ecs.Cluster;
}
