import * as cdk from '@aws-cdk/core';

import { PGInit } from './init';
import { Postgres } from './Postgres';
import { DatabaseProps } from './types';

export class DatabaseStack extends cdk.Stack {
  public readonly posgres: Postgres;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: DatabaseProps & cdk.StackProps,
  ) {
    super(scope, id, props);
    this.posgres = new Postgres(this, props);

    new PGInit(this, 'PGInit', {
      cluster: props.cluster,
      pgSecret: this.posgres.secret,
      pgHost: this.posgres.host,
      pgPort: this.posgres.port,
    });
  }
}
