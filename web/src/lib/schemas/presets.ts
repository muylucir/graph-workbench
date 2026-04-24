import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

const LAB_ROOT = process.env.GRAPH_LAB_ROOT ?? '/home/ec2-user/project/travel-graph-lab';
const SCHEMAS_DIR = path.join(LAB_ROOT, 'schemas');

export type Preset = {
  id: string;
  name: string;
  description: string;
  slot: 'A' | 'B' | 'C';
  yaml: string;
};

export function listPresets(): Preset[] {
  const files = fs
    .readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files.map((f) => {
    const yaml = fs.readFileSync(path.join(SCHEMAS_DIR, f), 'utf-8');
    // Quick parse: grab name/description/slot lines
    const name = /^name:\s*"?([^"\n]+)"?/m.exec(yaml)?.[1] ?? f;
    const description = /^description:\s*"?([^"\n]+)"?/m.exec(yaml)?.[1] ?? '';
    const slot = (/^slot:\s*([ABC])/m.exec(yaml)?.[1] ?? 'A') as 'A' | 'B' | 'C';
    return { id: f.replace(/\.ya?ml$/, ''), name, description, slot, yaml };
  });
}

export function getPreset(id: string): Preset | null {
  const p = path.join(SCHEMAS_DIR, `${id}.yaml`);
  if (!fs.existsSync(p)) return null;
  const yaml = fs.readFileSync(p, 'utf-8');
  const name = /^name:\s*"?([^"\n]+)"?/m.exec(yaml)?.[1] ?? id;
  const description = /^description:\s*"?([^"\n]+)"?/m.exec(yaml)?.[1] ?? '';
  const slot = (/^slot:\s*([ABC])/m.exec(yaml)?.[1] ?? 'A') as 'A' | 'B' | 'C';
  return { id, name, description, slot, yaml };
}
