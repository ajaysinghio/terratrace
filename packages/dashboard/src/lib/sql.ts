import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import pg from "pg";

// Hosted deploys talk to Neon over its HTTP driver, which can't connect to a
// plain Postgres. For the offline laptop demo (docker-compose.yml), a
// localhost DATABASE_URL gets a small adapter over `pg` that exposes only the
// slice of the Neon API db.ts uses: a lazy tagged-template query, and
// `transaction([...])` over such queries.

export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

interface LazyQuery extends PromiseLike<unknown[]> {
  text: string;
  values: unknown[];
}

let pool: pg.Pool | undefined;

function localSql(url: string) {
  pool ??= new pg.Pool({ connectionString: url });

  function query(strings: TemplateStringsArray, ...values: unknown[]): LazyQuery {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    const run = async () => (await pool!.query(text, values)).rows;
    return {
      text,
      values,
      then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
    };
  }

  query.transaction = async (queries: LazyQuery[]) => {
    const client = await pool!.connect();
    try {
      await client.query("begin");
      const results = [];
      for (const q of queries) results.push((await client.query(q.text, q.values)).rows);
      await client.query("commit");
      return results;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  };

  return query;
}

export function createSql(url: string): NeonQueryFunction<false, false> {
  if (isLocalDatabaseUrl(url)) {
    return localSql(url) as unknown as NeonQueryFunction<false, false>;
  }
  return neon(url);
}
