import { Construct } from 'constructs';

import { AppConfig } from '../types';

export class Config extends Construct {
  private static _roots: Map<string, AppConfig> = new Map();

  public static set(scope: Construct, props: AppConfig) {
    Config._roots.set(scope.node.root.node.addr, props);
  }

  public static get<T extends keyof AppConfig>(
    scope: Construct,
    propName: T,
  ): AppConfig[T] {
    const cfg = Config._roots.get(scope.node.root.node.addr);
    if (!cfg) {
      throw new Error('root config not found');
    }
    return cfg[propName];
  }
}
