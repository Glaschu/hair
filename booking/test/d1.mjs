import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/**
 * Enough of the D1 API for the Worker to run against real SQLite, so
 * tests exercise the actual SQL rather than a mock of it.
 */
export function makeD1(schemaPath) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaPath, 'utf8'));

  const prepare = (sql) => {
    let args = [];
    const stmt = {
      bind(...values) { args = values; return stmt; },
      async run() {
        const res = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(res.changes ?? 0) } };
      },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
    };
    return stmt;
  };

  return {
    prepare,
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    _raw: db,
  };
}
