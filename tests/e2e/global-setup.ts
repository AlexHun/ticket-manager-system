import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Seeds the test DB before the test run.
 *
 * The seed script is idempotent — it upserts both the admin and agent users
 * without touching existing rows. For a full wipe + remigrate, run
 * `bun run db:test:reset` manually before launching the suite.
 */
export default function globalSetup() {
  console.log("\n[global-setup] Seeding test database…");
  execSync("bun run db:test:seed", {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 60_000,
  });
  console.log("[global-setup] Test database ready.\n");
}
