import { Readable } from 'node:stream';

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const s3 = new S3Client();
const { S3_BUCKET, S3_PREFIX } = process.env;

/**
 * URLs of geofenced source files. Must be downloaded from a Canadian IP.
 * S3 key mirrors the URL path under the `quebec2/` prefix.
 */
const FILES = [
  'https://www.hydroquebec.com/data/documents-donnees/donnees-ouvertes/json/Donnees_VUE_CENTRALES_ET_OUVRAGES.json', // ~2.8 MB
  'https://www.hydroquebec.com/data/documents-donnees/donnees-ouvertes/json/Donnees_VUE_STATIONS_ET_TARAGES.json', // ~15.5 MB
];

async function cacheFile(
  url: string,
  bucket: string,
  prefix: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) {
    throw new Error(`Failed to fetch ${url}: response body is missing`);
  }

  const key = `${prefix}${new URL(url).pathname}`;

  await new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: Readable.fromWeb(response.body),
      ContentType: response.headers.get('content-type') ?? 'application/json',
    },
  }).done();
}

export const handler = async (): Promise<void> => {
  if (!S3_BUCKET || !S3_PREFIX) {
    throw new Error('s3 bucket and prefix are required');
  }
  await Promise.all(FILES.map(url => cacheFile(url, S3_BUCKET, S3_PREFIX)));
};
