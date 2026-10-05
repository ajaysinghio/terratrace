// Removes CUR upload data: every billing_uploads row, plus the cost/carbon
// estimates on findings (they all derive from billing correlation). Projects,
// findings, fixes and PR links are left alone. Run with:
//   pnpm --filter @terratrace/dashboard db:cur:clear:remote   (Neon, DATABASE_URL from .env)
//   pnpm --filter @terratrace/dashboard db:cur:clear:local    (docker-compose Postgres)
// Add --yes to skip the confirmation prompt.
import { createInterface } from "node:readline/promises";
import { neon } from "@neondatabase/serverless";
import pg from "pg";

const args = process.argv.slice(2);
const target = args.find((a) => a.startsWith("--target="))?.slice("--target=".length);
const skipPrompt = args.includes("--yes");

const LOCAL_URL =
  process.env.LOCAL_DATABASE_URL ?? "postgres://terratrace:terratrace@localhost:5433/terratrace";

const STATEMENTS = [
  `update findings set
     estimate_kg_co2e = null,
     estimate_methodology = null,
     estimate_grid_intensity_gco2_per_kwh = null,
     estimate_confidence = null,
     estimate_cost_usd = null,
     billing_upload_id = null`,
  `delete from billing_uploads`,
];

const COUNTS = `select
  (select count(*) from billing_uploads) as uploads,
  (select count(*) from findings where estimate_kg_co2e is not null) as estimates`;

function isLocal(url) {
  return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
}

function connect(url) {
  if (target === "local") {
    const pool = new pg.Pool({ connectionString: url });
    return {
      counts: async () => (await pool.query(COUNTS)).rows[0],
      clear: async () => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          for (const statement of STATEMENTS) await client.query(statement);
          await client.query("commit");
        } catch (err) {
          await client.query("rollback");
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const sql = neon(url);
  return {
    counts: async () => (await sql.query(COUNTS))[0],
    clear: async () => {
      await sql.transaction(STATEMENTS.map((statement) => sql.query(statement)));
    },
    close: async () => {},
  };
}

async function main() {
  if (target !== "remote" && target !== "local") {
    console.error("Usage: clear-cur.mjs --target=remote|local [--yes]");
    process.exit(1);
  }

  const url = target === "local" ? LOCAL_URL : process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — pass it in the environment or packages/dashboard/.env.");
    process.exit(1);
  }
  if (target === "remote" && isLocal(url)) {
    console.error("--target=remote but DATABASE_URL points at localhost; refusing. Use --target=local instead.");
    process.exit(1);
  }
  if (target === "local" && !isLocal(url)) {
    console.error("LOCAL_DATABASE_URL does not point at localhost; refusing.");
    process.exit(1);
  }

  const db = connect(url);
  try {
    const before = await db.counts();
    console.log(`Target: ${target} (${new URL(url).hostname})`);
    console.log(`Currently: ${before.uploads} CUR upload(s), ${before.estimates} finding(s) with a cost/carbon estimate.`);
    console.log("This deletes the upload history and clears those estimates. Projects, findings, fixes and PRs are kept.");

    if (!skipPrompt) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Type "clear" to continue: `);
      rl.close();
      if (answer.trim() !== "clear") {
        console.log("Aborted — nothing changed.");
        return;
      }
    }

    await db.clear();
    const after = await db.counts();
    console.log(`Done: ${after.uploads} upload(s), ${after.estimates} estimate(s) remain.`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
