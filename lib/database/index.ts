import * as ecs from '@aws-cdk/aws-ecs';
import * as cdk from '@aws-cdk/core';

import { BackupTask } from './BackupTask';
import { PGInit } from './init';
import { LegacyRestoreTask } from './LegacyRestoreTask';
import { Postgres } from './Postgres';
import { DatabaseProps } from './types';

export class DatabaseStack extends cdk.Stack {
  public readonly postgres: Postgres;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: DatabaseProps & cdk.StackProps,
  ) {
    super(scope, id, props);
    this.postgres = new Postgres(this, props);

    new PGInit(this, 'PGInit', {
      cluster: props.cluster,
      pgSecret: this.postgres.secret,
      pgHost: this.postgres.host,
      pgPort: this.postgres.port,
    });

    new LegacyRestoreTask(this, {
      password: ecs.Secret.fromSecretsManager(this.postgres.secret, 'password'),
      host: this.postgres.host,
    });

    new BackupTask(this, {
      password: ecs.Secret.fromSecretsManager(this.postgres.secret, 'password'),
      host: this.postgres.host,
    });
  }
}
