import * as ecs from '@aws-cdk/aws-ecs';

import { RootProps } from '../types';

export interface DatabaseProps extends RootProps {
  cluster: ecs.Cluster;
}
