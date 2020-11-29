import * as ecs from '@aws-cdk/aws-ecs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export interface PGInitProps {
  cluster: ecs.Cluster;
  pgSecret: secretsmanager.ISecret;
  pgHost: string;
  pgPort: string;
}

export interface PGInitResourceProps {
  pgSecretArn: string;
  pgHost: string;
  pgPort: string;
}
