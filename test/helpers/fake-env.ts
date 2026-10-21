/**
 * Test doubles for the Cloudflare bindings.
 *
 * The D1 double records every statement it is handed, because the whole
 * point of these tests is to count the statements the production code
 * issues. A double that cannot be inspected cannot prove a budget.
 */

export interface RecordedStatement {
  sql: string;
  /** "read" for SELECT, "write" for everything else. */
  kind: "read" | "write";
}

export interface FakeD1 {
  db: D1Database;
  statements: RecordedStatement[];
  /** The values bound to each statement, in the order they were given. */
  bound: unknown[][];
  /** Every SELECT statement that names the given table. */
  readsOf(table: string): string[];
  /** Every statement, read or write, that names the given table. */
  allOf(table: string): string[];
  reset(): void;
}

export type Responder = (sql: string, bound?: unknown[]) => { results: unknown[] } | null;

/**
 * A D1 double. `responders` maps a SQL fragment to the rows it returns;
 * the first matching fragment wins. The responder also receives the values
 * that were bound to the statement, so a responder can answer a lookup by
 * its key the way the database would.
 */
export function fakeD1(responders: Responder[] = []): FakeD1 {
  const statements: RecordedStatement[] = [];
  const bound: unknown[][] = [];

  function rowsFor(sql: string, args?: unknown[]): { results: unknown[] } {
    for (const responder of responders) {
      const hit = responder(sql, args);
      if (hit) return hit;
    }
    return { results: [] };
  }

  const db = {
    prepare(sql: string) {
      const trimmed = sql.trim();
      const kind: "read" | "write" = /^(select|pragma|with)/i.test(trimmed) ? "read" : "write";
      statements.push({ sql: trimmed, kind });
      const run = async () => {
        const { results } = rowsFor(trimmed);
        return { results, success: true, meta: { changes: 0 } };
      };
      return {
        sql: trimmed,
        bind: (...args: unknown[]) => {
          bound.push(args);
          return {
            first: async <T>() => {
              const { results } = rowsFor(trimmed, args);
              return (results[0] ?? null) as T | null;
            },
            all: async <T>() => {
              const { results } = rowsFor(trimmed, args);
              return { results: results as T[], success: true, meta: {} };
            },
            run: async () => {
              const { results } = rowsFor(trimmed, args);
              return { results, success: true, meta: { changes: results.length } };
            },
            raw: async () => new ArrayBuffer(0),
          };
        },
        first: async <T>() => {
          const { results } = rowsFor(trimmed);
          return (results[0] ?? null) as T | null;
        },
        all: async <T>() => {
          const { results } = rowsFor(trimmed);
          return { results: results as T[], success: true, meta: {} };
        },
        run: async () => {
          const { results } = rowsFor(trimmed);
          return { results, success: true, meta: { changes: results.length } };
        },
        raw: async () => new ArrayBuffer(0),
      };
    },
    batch: async (statementsToRun: unknown[]) => {
      const out: unknown[] = [];
      for (const s of statementsToRun as Array<{ sql?: string }>) {
        if (s?.sql) statements.push({ sql: s.sql.trim(), kind: "write" });
        out.push({ success: true, meta: { changes: 0 } });
      }
      return out;
    },
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;

  return {
    db,
    statements,
    bound,
    readsOf(table: string) {
      const needle = table.toLowerCase();
      return statements.filter((s) => s.kind === "read" && s.sql.toLowerCase().includes(needle)).map((s) => s.sql);
    },
    allOf(table: string) {
      const needle = table.toLowerCase();
      return statements.filter((s) => s.sql.toLowerCase().includes(needle)).map((s) => s.sql);
    },
    reset() {
      statements.length = 0;
    },
  };
}

export interface FakeKV {
  kv: KVNamespace;
  store: Map<string, string>;
  get(key: string): string | undefined;
}

export function fakeKV(initial: Record<string, unknown> = {}): FakeKV {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const kv = {
    get: async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      if (type === "arrayBuffer") return new TextEncoder().encode(raw).buffer;
      return raw;
    },
    put: async (key: string, value: unknown) => {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async (key: string) => {
      const raw = store.get(key);
      return { value: raw ?? null, metadata: null };
    },
  } as unknown as KVNamespace;

  return { kv, store, get: (key: string) => store.get(key) };
}
