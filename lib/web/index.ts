import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { Buckets } from './Buckets';

export class WebStack extends Stack {
  public readonly buckets: Buckets;
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.buckets = new Buckets(this);
  }
}
