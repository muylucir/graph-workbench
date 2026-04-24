import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const STUDY_ROOT = process.env.GRAPH_STUDY_ROOT ?? '/home/ec2-user/project/graph-study';
const SQLITE_PATH = path.join(STUDY_ROOT, 'osaka_subset', 'graph_hotel_info_osaka.sqlite');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(SQLITE_PATH)) {
      throw new Error(`SQLite not found at ${SQLITE_PATH}`);
    }
    db = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');
  }
  return db;
}

export type TableInfo = {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; pk: number; notnull: number }>;
};

export function listTables(): TableInfo[] {
  const d = getDb();
  const tables = d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return tables.map((t) => {
    const rowCount = (d.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }).c;
    const cols = d.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{
      name: string;
      type: string;
      pk: number;
      notnull: number;
    }>;
    return { name: t.name, rowCount, columns: cols };
  });
}

export function sampleRows(table: string, limit = 5): Array<Record<string, unknown>> {
  const d = getDb();
  return d.prepare(`SELECT * FROM "${table}" LIMIT ${limit}`).all() as Array<Record<string, unknown>>;
}

export function select<T = Record<string, unknown>>(sql: string): T[] {
  const d = getDb();
  return d.prepare(sql).all() as T[];
}

export function sqliteReady(): boolean {
  try {
    return fs.existsSync(SQLITE_PATH);
  } catch {
    return false;
  }
}
