import * as ecs from '@aws-cdk/aws-ecs';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export interface PGInitProps {
  cluster: ecs.Cluster;
  database: {
    secret: secretsmanager.ISecret;
    host: string;
    port: string;
  };
}

export interface PGInitResourceProps {
  pgSecretArn: string;
  pgHost: string;
  pgPort: string;
}
