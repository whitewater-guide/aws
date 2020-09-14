import * as ec2 from '@aws-cdk/aws-ec2';
import * as elasticache from '@aws-cdk/aws-elasticache';
import * as cloudmap from '@aws-cdk/aws-servicediscovery';
import * as cdk from '@aws-cdk/core';

import { DatabaseProps } from './types';

export class Redis {
  private readonly _scope: cdk.Construct;
  private readonly _cluster: elasticache.CfnCacheCluster;

  constructor(scope: cdk.Construct, props: DatabaseProps) {
    const { cluster } = props;
    this._scope = scope;
    const vpc: ec2.Vpc = cluster.vpc as ec2.Vpc;

    const subnetGroup = new elasticache.CfnSubnetGroup(
      scope,
      'RedisPrivateSubnetGroup',
      {
        subnetIds: vpc.privateSubnets.map((n) => n.subnetId),
        description: 'redis private subnet group',
      },
    );

    this._cluster = new elasticache.CfnCacheCluster(scope, 'RedisCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [vpc.vpcDefaultSecurityGroup],
      cacheSubnetGroupName: subnetGroup.ref,
    });

    // Enable service discovery
    if (cluster.defaultCloudMapNamespace) {
      const service = new cloudmap.Service(
        this._scope,
        'RedisCloudmapService',
        {
          namespace: cluster.defaultCloudMapNamespace,
          name: 'redis',
          dnsRecordType: cloudmap.DnsRecordType.CNAME,
        },
      );
      service.registerCnameInstance('RedisCloudmapInstance', {
        instanceCname: this._cluster.attrRedisEndpointAddress,
      });
    }
  }

  public get host(): string {
    return this._cluster.attrRedisEndpointAddress;
  }
}
