import * as acm from '@aws-cdk/aws-certificatemanager';
import * as route53 from '@aws-cdk/aws-route53';
import * as cdk from '@aws-cdk/core';

interface CertificatesStackProps extends cdk.StackProps {
  topLevelDomain: string;
}

/**
 * Certificated are deployed manually in another stack and are referenced by their arn
 * This is to avoid limit on number of certificates: https://github.com/aws/aws-cdk/issues/5889
 */
export default class CertificatesStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: CertificatesStackProps) {
    super(scope, id, props);
    const { topLevelDomain } = props;

    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: topLevelDomain,
    });

    const certificate = new acm.DnsValidatedCertificate(
      this,
      `GlobalWildcardCertificate`,
      {
        domainName: topLevelDomain,
        subjectAlternativeNames: [`*.${topLevelDomain}`],
        hostedZone,
        region: 'us-east-1',
      },
    );

    new cdk.CfnOutput(this, 'GlobalCertificateArnOutput', {
      value: certificate.certificateArn,
    });
  }
}
