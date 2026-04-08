import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface Migrate13To18Props {
  cluster: ecs.Cluster;
  secrets: {
    pg13: secretsmanager.ISecret;
    pg18: secretsmanager.ISecret;
  };
}

export interface Migrate13To18ResourceProps {
  taskDefArn: string;
  clusterArn: string;
  subnets: string[];
}
