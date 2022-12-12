import * as ecs from 'aws-cdk-lib/aws-ecs';

interface LogDriverOptions {
  lokiLabels?: Record<string, string>;
  useJson?: boolean;
}

/**
 * Returns firelens log router config with loki/fluentbut config
 * https://grafana.com/docs/loki/latest/clients/fluentbit/
 *
 */
export function lokiLogDriver(
  jobId: string,
  { lokiLabels, useJson = true }: LogDriverOptions = {},
): ecs.LogDriver {
  const allLabels = { job: jobId, ...lokiLabels };
  const labels = Object.entries(allLabels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')
    .toLowerCase();

  return ecs.LogDrivers.firelens({
    options: {
      Name: 'grafana-loki',
      // Loki is just another fargate service. Use cloudmap service discovery
      Url: 'http://loki.local:3100/loki/api/v1/push',
      Labels: `{${labels}}`,
      LineFormat: useJson ? 'json' : 'key_value',
      RemoveKeys:
        'container_id,container_name,source,ecs_task_arn,ecs_task_definition,ecs_cluster',
    },
  });
}
