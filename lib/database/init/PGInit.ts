import * as ec2 from '@aws-cdk/aws-ec2';
import * as cdk from '@aws-cdk/core';

import PGInitProvider from './PGInitProvider';
import { PGInitProps } from './types';

export class PGInit extends cdk.Construct {
  constructor(
    scope: cdk.Construct,
    id: string,
    vpc: ec2.IVpc,
    props: PGInitProps,
  ) {
    super(scope, id);

    new cdk.CustomResource(this, 'PGInit', {
      serviceToken: PGInitProvider.getOrCreate(this, vpc),
      resourceType: 'Custom::PGInit',
      properties: props,
    });
  }
}
