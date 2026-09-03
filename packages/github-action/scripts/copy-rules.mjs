import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Copy the Semgrep rule pack from @terratrace/core into the Action's bundled
// dist so `SemgrepAnalyzer({ rulesDir: <bundled> })` works regardless of
// which repo invokes the Action. Called after `ncc build` in the Action's
// build script.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "..", "core", "rules-semgrep");
const DST = path.resolve(HERE, "..", "dist", "rules-semgrep");

await rm(DST, { recursive: true, force: true });
await mkdir(path.dirname(DST), { recursive: true });
await cp(SRC, DST, { recursive: true });

console.log(`copy-rules: copied ${SRC} -> ${DST}`);
