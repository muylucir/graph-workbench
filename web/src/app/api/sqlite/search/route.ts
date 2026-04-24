import { NextResponse } from 'next/server';
import { listTables, getDb } from '@/lib/sqlite/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Prefix autocomplete on a single SQLite column.
 *
 *   GET /api/sqlite/search?table=package_attraction&column=landmarkNameKo&q=오사카
 *
 * Restricted to the known table/column set (from `listTables()`) so users can't
 * inject arbitrary identifiers. Returns at most 20 distinct matches.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const table = url.searchParams.get('table');
  const column = url.searchParams.get('column');
  const q = url.searchParams.get('q') ?? '';

  if (!table || !column) {
    return NextResponse.json({ error: 'table and column required' }, { status: 400 });
  }
  if (q.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  // Identifier whitelist check
  const meta = listTables().find((t) => t.name === table);
  if (!meta) {
    return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  }
  const col = meta.columns.find((c) => c.name === column);
  if (!col) {
    return NextResponse.json({ error: 'unknown column' }, { status: 404 });
  }

  // Optional `id_column` for returning both label and id side-by-side (declared_fact)
  const idColumn = url.searchParams.get('idColumn');
  const hasId =
    idColumn && meta.columns.some((c) => c.name === idColumn) ? idColumn : null;

  const db = getDb();
  const sql = hasId
    ? `SELECT DISTINCT "${hasId}" AS id, "${column}" AS label
         FROM "${table}"
         WHERE "${column}" LIKE ? COLLATE NOCASE
         LIMIT 20`
    : `SELECT DISTINCT "${column}" AS label
         FROM "${table}"
         WHERE "${column}" LIKE ? COLLATE NOCASE
         LIMIT 20`;
  const rows = db.prepare(sql).all(`%${q.trim()}%`) as Array<{ id?: string; label: string }>;
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id ?? r.label,
      label: r.label,
    })),
  });
}
