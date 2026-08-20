import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetE2eEmails, resetE2eUsers, testDb } from "./helpers/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Seeds the test DB before the test run, then sweeps users left behind by
 * earlier runs.
 *
 * The seed script is idempotent — it upserts both the admin and agent users
 * without touching existing rows. For a full wipe + remigrate, run
 * `bun run db:test:reset` manually before launching the suite.
 *
 * The sweep runs here rather than only in an afterAll hook so that a run which
 * crashed, timed out, or was killed mid-way still leaves a clean DB for the
 * next one.
 */
export default async function globalSetup() {
  console.log("\n[global-setup] Seeding test database…");
  execSync("bun run db:test:seed", {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 60_000,
  });

  const removed = await resetE2eUsers();
  if (removed > 0) {
    console.log(`[global-setup] Removed ${removed} leftover e2e user(s).`);
  }

  // Swept separately because the outbox has no foreign key to User — deleting
  // the accounts leaves their invitations behind, each holding a link that
  // still works.
  const unsent = await resetE2eEmails();
  if (unsent > 0) {
    console.log(`[global-setup] Removed ${unsent} leftover e2e email(s).`);
  }

  await testDb.$disconnect();

  console.log("[global-setup] Test database ready.\n");
}
