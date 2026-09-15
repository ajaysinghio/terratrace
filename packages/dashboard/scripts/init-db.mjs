// Applies db/schema.sql against DATABASE_URL. Run with:
//   DATABASE_URL=... node scripts/init-db.mjs
// or, with a .env file: node --env-file=.env scripts/init-db.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Provision a Postgres database (e.g. via the Vercel Storage tab's Neon integration) and pass its connection string as DATABASE_URL.");
    process.exit(1);
  }

  const schemaPath = path.join(dirname, "..", "db", "schema.sql");
  const schema = await readFile(schemaPath, "utf-8");

  const sql = neon(databaseUrl);
  // Strip line comments before splitting on ";" — schema.sql's comments
  // contain literal semicolons, which would otherwise break a statement
  // mid-way. neon's tagged-template client only runs single statements,
  // so send the rest as one batch over sql.transaction's raw query.
  const withoutComments = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  await sql.transaction(
    withoutComments
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
      .map((statement) => sql.query(statement))
  );

  console.log(`Applied ${schemaPath} to ${new URL(databaseUrl).hostname}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
