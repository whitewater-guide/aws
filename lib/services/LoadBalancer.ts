import * as cert from 'aws-cdk-lib/aws-certificatemanager';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import upperFirst from 'lodash/upperFirst';

import { Config } from '../config';

export interface LoadBalancerProps {
  cluster: ecs.Cluster;
}

export class LoadBalancer {
  private _topLevelDomain: string;
  private _listener: elbv2.ApplicationListener;
  private _scope: Construct;
  private _route53Target: route53.RecordTarget;
  private _hostedZone?: route53.IHostedZone;

  constructor(scope: Construct, props: LoadBalancerProps) {
    const { cluster } = props;
    this._topLevelDomain = Config.get(scope, 'topLevelDomain');
    this._scope = scope;

    const certificate = cert.Certificate.fromCertificateArn(
      scope,
      'ALBWildcartCertificate',
      Config.get(scope, 'wildcardCertArn'),
    );

    const balancer = new elbv2.ApplicationLoadBalancer(scope, 'ALB', {
      vpc: cluster.vpc,
      internetFacing: true,
    });
    balancer.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
    });
    this._listener = balancer.addListener('PublicListener', {
      protocol: elbv2.ApplicationProtocol.HTTPS,
      open: true,
    });
    this._listener.addCertificates('PublicListenerCert', [certificate]);
    this._listener.addAction('Fixed404', {
      action: elbv2.ListenerAction.fixedResponse(404),
    });

    this._route53Target = route53.RecordTarget.fromAlias(
      new targets.LoadBalancerTarget(balancer),
    );
  }

  public addServiceTarget(
    priority: number,
    subdomain: string,
    props: elbv2.AddApplicationTargetsProps,
  ) {
    const prefix = upperFirst(subdomain);
    this._listener.addTargets(`${prefix}ALBTarget`, {
      ...props,
      priority,
      conditions: [
        elbv2.ListenerCondition.hostHeaders([
          `${subdomain}.${this._topLevelDomain}`,
        ]),
        ...(props.conditions ?? []),
      ],
    });
    new route53.ARecord(this._scope, `${prefix}Route53Record`, {
      zone: this.hostedZone,
      recordName: `${subdomain}.${this._topLevelDomain}`,
      target: this._route53Target,
    });
  }

  private get hostedZone() {
    if (!this._hostedZone) {
      this._hostedZone = route53.HostedZone.fromLookup(
        this._scope,
        'ALBHostedZone',
        {
          domainName: this._topLevelDomain,
          privateZone: false,
        },
      );
    }
    return this._hostedZone;
  }
}
