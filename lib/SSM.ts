import * as ssm from '@aws-cdk/aws-ssm';
import * as cdk from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';
import { camelCase, upperFirst } from 'lodash';

export class SSM {
  private static _secretResources = new Map<string, cr.AwsCustomResource>();

  public static MAIL_SMTP_SERVER = 'MAIL_SMTP_SERVER';
  public static MAIL_PASSWORD = 'MAIL_PASSWORD';
  public static MAIL_NOREPLY_BOX = 'MAIL_NOREPLY_BOX';
  public static MAIL_INFO_BOX = 'MAIL_INFO_BOX';
  public static MAILCHIMP_API_KEY = 'MAILCHIMP_API_KEY';
  public static MAILCHIMP_LIST_ID = 'MAILCHIMP_LIST_ID';

  public static IMGPROXY_KEY = 'IMGPROXY_KEY';
  public static IMGPROXY_SALT = 'IMGPROXY_SALT';
  public static IMGPROXY_SECRET = 'IMGPROXY_SECRET';

  public static ACCESS_TOKEN_SECRET = 'ACCESS_TOKEN_SECRET';
  public static ACCESS_TOKEN_EXPIRES = 'ACCESS_TOKEN_EXPIRES';
  public static REFRESH_TOKEN_SECRET = 'REFRESH_TOKEN_SECRET';
  public static DESCENTS_TOKEN_SECRET = 'DESCENTS_TOKEN_SECRET';

  public static FB_APP_ID = 'FB_APP_ID';
  public static FB_SECRET = 'FB_SECRET';

  public static GOOGLE_SERVICE_ACCOUNT = 'GOOGLE_SERVICE_ACCOUNT';

  public static string(scope: cdk.Construct, id: string) {
    return ssm.StringParameter.valueForStringParameter(scope, id);
  }

  // Get the latest version of a secure SSM parameter
  public static secret(scope: cdk.Construct, id: string) {
    let res = SSM._secretResources.get(scope.node.uniqueId + '/' + id);
    if (!res) {
      const suffix = upperFirst(camelCase(id));
      res = new cr.AwsCustomResource(scope, `GetParameter${suffix}`, {
        onUpdate: {
          // will also be called for a CREATE event
          service: 'SSM',
          action: 'getParameter',
          parameters: {
            Name: id,
            WithDecryption: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // Update physical id to always fetch the latest version
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      });
      SSM._secretResources.set(scope.node.uniqueId + '/' + id, res);
    }
    return res.getResponseField('Parameter.Value');
  }
}
