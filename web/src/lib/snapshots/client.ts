import 'server-only';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const TABLE = process.env.DYNAMODB_SNAPSHOTS_TABLE ?? 'travel-graph-lab-snapshots';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const PK = 'snapshot';

let _doc: DynamoDBDocumentClient | null = null;
function doc(): DynamoDBDocumentClient {
  if (_doc) return _doc;
  _doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION, credentials: defaultProvider() }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return _doc;
}

export type Snapshot = {
  id: string;
  name: string;
  description?: string;
  yaml: string;
  sourcePreset?: string;
  createdAt: string;
  updatedAt: string;
};

export type SnapshotSummary = Omit<Snapshot, 'yaml'>;

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listSnapshots(): Promise<SnapshotSummary[]> {
  const out = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': PK },
      ProjectionExpression: 'sk, #n, description, sourcePreset, createdAt, updatedAt',
      ExpressionAttributeNames: { '#n': 'name' },
      ScanIndexForward: false,
    }),
  );
  const items = (out.Items ?? []) as Array<Record<string, unknown>>;
  return items
    .map((it) => ({
      id: String(it.sk),
      name: String(it.name ?? ''),
      description: it.description as string | undefined,
      sourcePreset: it.sourcePreset as string | undefined,
      createdAt: String(it.createdAt ?? ''),
      updatedAt: String(it.updatedAt ?? ''),
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getSnapshot(id: string): Promise<Snapshot | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK, sk: id } }),
  );
  if (!out.Item) return null;
  const it = out.Item as Record<string, unknown>;
  return {
    id,
    name: String(it.name ?? ''),
    description: it.description as string | undefined,
    yaml: String(it.yaml ?? ''),
    sourcePreset: it.sourcePreset as string | undefined,
    createdAt: String(it.createdAt ?? ''),
    updatedAt: String(it.updatedAt ?? ''),
  };
}

export async function saveSnapshot(input: {
  id?: string;
  name: string;
  description?: string;
  yaml: string;
  sourcePreset?: string;
}): Promise<Snapshot> {
  const now = new Date().toISOString();
  const id = input.id ?? genId();
  const existing = input.id ? await getSnapshot(id) : null;
  const snap: Snapshot = {
    id,
    name: input.name,
    description: input.description,
    yaml: input.yaml,
    sourcePreset: input.sourcePreset,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK,
        sk: id,
        name: snap.name,
        description: snap.description,
        yaml: snap.yaml,
        sourcePreset: snap.sourcePreset,
        createdAt: snap.createdAt,
        updatedAt: snap.updatedAt,
      },
    }),
  );
  return snap;
}

export async function deleteSnapshot(id: string): Promise<void> {
  await doc().send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: PK, sk: id } }),
  );
}
