import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import AWS from 'aws-sdk';
import { Client } from 'pg';

export const onEvent = async (event: CloudFormationCustomResourceEvent) => {
  if (event.RequestType !== 'Create') {
    return;
  }
  const secretsManager = new AWS.SecretsManager();
  const secret = await secretsManager
    .getSecretValue({ SecretId: event.ResourceProperties.pgSecretArn })
    .promise();

  if (!secret.SecretString) {
    console.error('Secret not found');
    throw new Error('Secret not found');
  }
  const { password } = JSON.parse(secret.SecretString);

  const client = new Client({
    user: 'postgres',
    host: event.ResourceProperties.pgHost,
    database: 'postgres',
    password,
    port: parseInt(event.ResourceProperties.pgPort, 10),
  });
  await client.connect();
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm";
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "postgis";
  `);
  await client.query('CREATE DATABASE wwguide');
  await client.query('CREATE DATABASE gorge');
  await client.end();
};
