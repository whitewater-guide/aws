import AWS from 'aws-sdk';
import chalk from 'chalk';
import { program } from 'commander';
import flatMap from 'lodash/flatMap';
import waitFor from 'p-wait-for';

AWS.config.region = 'us-east-1';

interface CommonOptions {
  profile: string;
}

interface Stoppable {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

class CloudFront implements Stoppable {
  private readonly cf = new AWS.CloudFront();

  private async getDistributions(
    enabled: boolean,
  ): Promise<AWS.CloudFront.DistributionSummary[]> {
    const { DistributionList } = await this.cf.listDistributions().promise();
    return DistributionList?.Items?.filter((d) => d.Enabled === enabled) ?? [];
  }

  private async toggleDistribution(
    distr: AWS.CloudFront.DistributionSummary,
    enabled: boolean,
  ): Promise<void> {
    const { Id, Aliases, DomainName } = distr;
    const domain = Aliases.Items?.[0] ?? DomainName;
    const { DistributionConfig, ETag } = await this.cf
      .getDistributionConfig({ Id })
      .promise();
    if (!DistributionConfig || !ETag) {
      return;
    }
    DistributionConfig.Enabled = enabled;
    await this.cf
      .updateDistribution({ Id, DistributionConfig, IfMatch: ETag })
      .promise();
    console.info(
      `${enabled ? 'Enabled' : 'Disabled'} distribution for ${chalk.yellow(
        domain,
      )}`,
    );
  }

  public async start(): Promise<void> {
    const distributions = await this.getDistributions(false);
    await Promise.all(
      distributions.map((distr) => this.toggleDistribution(distr, true)),
    );
  }

  public async stop(): Promise<void> {
    const distributions = await this.getDistributions(true);
    await Promise.all(
      distributions.map((distr) => this.toggleDistribution(distr, false)),
    );
  }
}

class ECSServices implements Stoppable {
  private readonly ecs = new AWS.ECS();
  private readonly tags = new AWS.ResourceGroupsTaggingAPI();

  private async getServices(enabled: boolean): Promise<AWS.ECS.Service[]> {
    const { clusterArns } = await this.ecs.listClusters().promise();
    const { ResourceTagMappingList } = await this.tags
      .getResources({
        TagFilters: [
          {
            Key: 'wwguide:stoppable',
            Values: ['true'],
          },
        ],
        ResourceTypeFilters: ['ecs:service'],
      })
      .promise();
    const { services } = await this.ecs
      .describeServices({
        services: ResourceTagMappingList?.map((r) => r.ResourceARN!) ?? [],
        cluster: clusterArns?.[0],
      })
      .promise();
    return (
      services?.filter(({ desiredCount = 0 }) =>
        enabled ? desiredCount > 0 : desiredCount === 0,
      ) ?? []
    );
  }

  private async toggleService(service: AWS.ECS.Service, enabled: boolean) {
    const dcTag = service.tags?.find((t) => t.key === 'wwguide:desiredCount');
    const desiredCount = enabled ? parseInt(dcTag?.value ?? '1') : 0;

    await this.ecs
      .updateService({
        cluster: service.clusterArn,
        service: service.serviceArn!,
        desiredCount,
      })
      .promise();
    console.info(
      `Scaling ${chalk.yellow(service.serviceName)} ${
        enabled ? 'up' : 'down'
      } to ${chalk.yellow(desiredCount)} instances...`,
    );

    await waitFor(async () => {
      const { services } = await this.ecs
        .describeServices({
          services: [service.serviceArn!],
          cluster: service.clusterArn!,
        })
        .promise();
      return services?.[0]?.runningCount === desiredCount;
    });

    console.info(
      `Scaled ${chalk.yellow(service.serviceName)} ${
        enabled ? 'up' : 'down'
      } to ${chalk.yellow(desiredCount)} instances`,
    );
  }

  public async start(): Promise<void> {
    const services = await this.getServices(false);
    await Promise.all(
      services.map((service) => this.toggleService(service, true)),
    );
  }

  public async stop(): Promise<void> {
    const services = await this.getServices(true);
    await Promise.all(
      services.map((service) => this.toggleService(service, false)),
    );
  }
}

class Postgres implements Stoppable {
  private readonly rds = new AWS.RDS();
  private readonly tags = new AWS.ResourceGroupsTaggingAPI();

  private async getInstances(enabled: boolean): Promise<AWS.RDS.DBInstance[]> {
    const { DBInstances } = await this.rds.describeDBInstances().promise();
    return (
      DBInstances?.filter(
        (i) => i.DBInstanceStatus === (enabled ? 'available' : 'stopped'),
      ) ?? []
    );
  }

  private async toggleInstance(instance: AWS.RDS.DBInstance, enabled: boolean) {
    const { DBInstanceIdentifier, DBName } = instance;
    if (!DBInstanceIdentifier) {
      return;
    }
    if (enabled) {
      await this.rds.startDBInstance({ DBInstanceIdentifier }).promise();
    } else {
      await this.rds.stopDBInstance({ DBInstanceIdentifier }).promise();
    }
    console.info(
      `Waiting for postgres instance ${chalk.yellow(DBName)} to ${
        enabled ? 'start' : 'stop'
      }`,
    );
    await waitFor(
      async () => {
        const { DBInstances } = await this.rds
          .describeDBInstances({ DBInstanceIdentifier })
          .promise();
        return (
          DBInstances?.[0].DBInstanceStatus ===
          (enabled ? 'available' : 'stopped')
        );
      },
      { interval: 30000 },
    );
    console.info(
      `${enabled ? 'Started' : 'Stopped'} postgres instance ${chalk.yellow(
        DBName,
      )}`,
    );
  }

  public async start(): Promise<void> {
    const instances = await this.getInstances(false);
    await Promise.all(
      instances.map((instance) => this.toggleInstance(instance, true)),
    );
  }

  public async stop(): Promise<void> {
    const instances = await this.getInstances(true);
    await Promise.all(
      instances.map((instance) => this.toggleInstance(instance, false)),
    );
  }
}

class NatInstances implements Stoppable {
  private readonly ec2 = new AWS.EC2();

  private async getInstances(enabled: boolean): Promise<AWS.EC2.Instance[]> {
    const { Reservations } = await this.ec2.describeInstances().promise();
    return flatMap(Reservations ?? [], (r) => r.Instances ?? [])
      .filter((i) => i.Tags?.some((t) => t.Key === 'wwguide:vpc'))
      .filter((i) => i.State?.Name === (enabled ? 'running' : 'stopped'));
  }

  private async toggleInstance(instance: AWS.EC2.Instance, enabled: boolean) {
    const { InstanceId } = instance;
    if (!InstanceId) {
      return;
    }
    if (enabled) {
      await this.ec2.startInstances({ InstanceIds: [InstanceId] }).promise();
    } else {
      await this.ec2.stopInstances({ InstanceIds: [InstanceId] }).promise();
    }
    console.info(
      `Waiting for EC2 instance ${chalk.yellow(InstanceId)} to ${
        enabled ? 'start' : 'stop'
      }`,
    );
    await waitFor(
      async () => {
        const { Reservations } = await this.ec2
          .describeInstances({ InstanceIds: [InstanceId] })
          .promise();
        return (
          Reservations?.[0].Instances?.[0].State?.Name ===
          (enabled ? 'running' : 'stopped')
        );
      },
      { interval: 30000 },
    );
    console.info(
      `${enabled ? 'Started' : 'Stopped'} ec2 instance ${chalk.yellow(
        InstanceId,
      )}`,
    );
  }

  public async start(): Promise<void> {
    const instances = await this.getInstances(false);
    await Promise.all(
      instances.map((instance) => this.toggleInstance(instance, true)),
    );
  }

  public async stop(): Promise<void> {
    const instances = await this.getInstances(true);
    await Promise.all(
      instances.map((instance) => this.toggleInstance(instance, false)),
    );
  }
}

const resources: Stoppable[] = [
  new NatInstances(),
  new Postgres(),
  new ECSServices(),
  new CloudFront(),
];

program
  .command('start')
  .description('Starts stopped stack')
  .requiredOption('--profile <profile>', 'aws profile to use')
  .action(async ({ profile }: CommonOptions) => {
    const credentials = new AWS.SharedIniFileCredentials({ profile });
    console.info(chalk`Using AWS Profile: {green ${profile}}`);
    AWS.config.credentials = credentials;
    console.info(chalk.green('Starting...'));
    for (const r of resources) {
      await r.start();
    }
    console.info(chalk.green('Started everything'));
  });

program
  .command('stop')
  .description('Stops started stack')
  .requiredOption('--profile <profile>', 'aws profile to use')
  .action(async ({ profile }: CommonOptions) => {
    const credentials = new AWS.SharedIniFileCredentials({ profile });
    console.info(chalk`Using AWS Profile: {green ${profile}}`);
    AWS.config.credentials = credentials;
    console.info(chalk.red('Stopping...'));
    const res = resources.slice().reverse();
    for (const r of res) {
      await r.stop();
    }
    console.info(chalk.red('Stopped everything'));
  });

program.parse(process.argv);
