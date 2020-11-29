import * as cdk from '@aws-cdk/core';

import { Buckets } from './Buckets';

export class WebStack extends cdk.Stack {
  public readonly buckets: Buckets;
  constructor(scope: cdk.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    this.buckets = new Buckets(this);
  }
}
