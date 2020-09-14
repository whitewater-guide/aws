import * as cdk from '@aws-cdk/core';

import { PGInit } from './init';
import { Postgres } from './Postgres';
import { Redis } from './Redis';
import { DatabaseProps } from './types';

export class DatabaseStack extends cdk.Stack {
  public readonly posgres: Postgres;
  public readonly redis: Redis;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: DatabaseProps & cdk.StackProps,
  ) {
    super(scope, id, props);
    this.posgres = new Postgres(this, props);
    this.redis = new Redis(this, props);

    new PGInit(this, 'PGInit', props.cluster.vpc, {
      pgSecretArn: this.posgres.secret.secretArn,
      pgHost: this.posgres.host,
      pgPort: this.posgres.port,
    });
  }
}
