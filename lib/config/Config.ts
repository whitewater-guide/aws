import * as cdk from '@aws-cdk/core';

import { AppConfig } from '../types';

export class Config extends cdk.Construct {
  private static _roots: Map<string, AppConfig> = new Map();

  public static set(scope: cdk.Construct, props: AppConfig) {
    Config._roots.set(scope.node.root.node.addr, props);
  }

  public static get<T extends keyof AppConfig>(
    scope: cdk.Construct,
    propName: T,
  ): AppConfig[T] {
    const cfg = Config._roots.get(scope.node.root.node.addr);
    if (!cfg) {
      throw new Error('root config not found');
    }
    return cfg[propName];
  }
}
