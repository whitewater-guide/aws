import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';

export class SSM {
  public static MAIL_SMTP_SERVER = 'MAIL_SMTP_SERVER';
  public static MAIL_PASSWORD = 'MAIL_PASSWORD';
  public static MAIL_NOREPLY_BOX = 'MAIL_NOREPLY_BOX';
  public static MAIL_INFO_BOX = 'MAIL_INFO_BOX';
  public static MAILCHIMP_API_KEY = 'MAILCHIMP_API_KEY';
  public static MAILCHIMP_LIST_ID = 'MAILCHIMP_LIST_ID';

  public static IMGPROXY_KEY = 'IMGPROXY_KEY';
  public static IMGPROXY_SALT = 'IMGPROXY_SALT';

  public static ACCESS_TOKEN_SECRET = 'ACCESS_TOKEN_SECRET';
  public static REFRESH_TOKEN_SECRET = 'REFRESH_TOKEN_SECRET';
  public static DESCENTS_TOKEN_SECRET = 'DESCENTS_TOKEN_SECRET';

  public static FB_APP_ID = 'FB_APP_ID';
  public static FB_SECRET = 'FB_SECRET';

  public static GOOGLE_SERVICE_ACCOUNT = 'GOOGLE_SERVICE_ACCOUNT';

  public static GORGE_HEALTH_KEY = 'GORGE_HEALTH_KEY';
  public static GORGE_HEALTH_EMAILS = 'GORGE_HEALTH_EMAILS';

  public static PUCON_PROMO_EMAILS = 'PUCON_PROMO_EMAILS';

  public static PGADMIN_DEFAULT_EMAIL = 'PGADMIN_DEFAULT_EMAIL';
  public static PGADMIN_DEFAULT_PASSWORD = 'PGADMIN_DEFAULT_PASSWORD';

  public static SYNAPSE_REGISTRATION_SECRET = 'SYNAPSE_REGISTRATION_SECRET';
  public static SYNAPSE_ADMIN_PASSWORD = 'SYNAPSE_ADMIN_PASSWORD';
  public static SYNAPSE_FORM_SECRET = 'SYNAPSE_FORM_SECRET';
  public static SYNAPSE_SIGNING_KEY = 'SYNAPSE_SIGNING_KEY';
  public static SYNAPSE_MACAROON_KEY = 'SYNAPSE_MACAROON_KEY';

  public static string(scope: Construct, id: string, version?: number) {
    return ssm.StringParameter.valueForStringParameter(scope, id, version);
  }

  // Get the latest version of a secure SSM parameter
  public static secret(scope: Construct, id: string, version = 1): ecs.Secret {
    const name = upperFirst(camelCase(id));
    const existing: any = scope.node.tryFindChild(name);
    return ecs.Secret.fromSsmParameter(
      existing ??
        ssm.StringParameter.fromSecureStringParameterAttributes(scope, name, {
          parameterName: id,
          version,
        }),
    );
  }
}
