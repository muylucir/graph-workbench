import 'server-only';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { Hash } from '@smithy/hash-node';
import { NodeHttpHandler } from '@smithy/node-http-handler';

const ENDPOINT = process.env.NEPTUNE_ENDPOINT ?? '';
const PORT = Number(process.env.NEPTUNE_PORT ?? '8182');
const REGION =
  process.env.NEPTUNE_REGION ??
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  'ap-northeast-2';
const AUTH = (process.env.NEPTUNE_AUTH ?? 'AWS_IAM').toUpperCase();

export function isNeptuneConfigured(): boolean {
  return Boolean(ENDPOINT);
}

export type NeptuneQueryResult = {
  columns: string[];
  rows: unknown[][];
  raw: unknown;
  elapsedMs: number;
};

export async function runOpenCypher(
  query: string,
  parameters?: Record<string, unknown>,
): Promise<NeptuneQueryResult> {
  if (!ENDPOINT) throw new Error('NEPTUNE_ENDPOINT not configured');

  const form: Record<string, string> = { query };
  if (parameters) form.parameters = JSON.stringify(parameters);
  const body = new URLSearchParams(form).toString();
  const hostHeader = PORT === 443 ? ENDPOINT : `${ENDPOINT}:${PORT}`;

  const baseRequest = new HttpRequest({
    method: 'POST',
    protocol: 'https:',
    hostname: ENDPOINT,
    port: PORT,
    path: '/openCypher',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: hostHeader,
    },
    body,
  });

  let finalRequest: HttpRequest = baseRequest;
  if (AUTH === 'AWS_IAM') {
    const signer = new SignatureV4({
      credentials: defaultProvider(),
      region: REGION,
      service: 'neptune-db',
      sha256: Hash.bind(null, 'sha256'),
    });
    finalRequest = (await signer.sign(baseRequest)) as HttpRequest;
  }

  const handler = new NodeHttpHandler({ requestTimeout: 60_000 });
  const start = Date.now();
  const { response } = await handler.handle(finalRequest);
  const elapsedMs = Date.now() - start;

  const chunks: Buffer[] = [];
  const stream = response.body as NodeJS.ReadableStream;
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf-8');

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Neptune HTTP ${response.statusCode}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  const results = data.results ?? [];
  const columns = results.length > 0 ? Object.keys(results[0]) : [];
  const rows = results.map((row: Record<string, unknown>) => columns.map((c) => row[c]));
  return { columns, rows, raw: data, elapsedMs };
}

export async function ping(): Promise<{ ok: boolean; error?: string; elapsedMs?: number }> {
  try {
    const r = await runOpenCypher('MATCH (n) RETURN count(n) AS total LIMIT 1');
    return { ok: true, elapsedMs: r.elapsedMs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
