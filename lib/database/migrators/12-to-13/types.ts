import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface Migrate12To13Props {
  cluster: ecs.Cluster;
  secrets: {
    pg12: secretsmanager.ISecret;
    pg13: secretsmanager.ISecret;
  };
}

export interface Migrate12To13ResourceProps {
  taskDefArn: string;
  clusterArn: string;
  subnets: string[];
}
