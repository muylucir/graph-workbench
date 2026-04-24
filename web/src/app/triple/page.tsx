import fs from 'node:fs/promises';
import path from 'node:path';
import TripleDocView from './TripleDocView';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LAB_ROOT = process.env.GRAPH_LAB_ROOT ?? '/home/ec2-user/project/travel-graph-lab';
const DOC_PATH = path.join(LAB_ROOT, 'docs', 'RDB_TO_TRIPLE.md');

export default async function TriplePage() {
  let markdown = '';
  let error: string | null = null;
  try {
    markdown = await fs.readFile(DOC_PATH, 'utf-8');
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return <TripleDocView markdown={markdown} error={error} />;
}
