import * as ecs from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export function logRouter(
  debug = false,
): ecs.FirelensLogRouterDefinitionOptions {
  return {
    essential: true,
    image: ecs.ContainerImage.fromRegistry(
      'grafana/fluent-bit-plugin-loki:2.7.0-amd64',
    ),
    firelensConfig: {
      type: ecs.FirelensLogRouterType.FLUENTBIT,
      options: {
        enableECSLogMetadata: false,
      },
    },
    memoryReservationMiB: 50,
    logging: debug
      ? new ecs.AwsLogDriver({
          streamPrefix: 'fbloki',
          logRetention: RetentionDays.ONE_DAY,
        })
      : undefined,
  };
}
