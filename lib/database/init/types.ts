import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

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
