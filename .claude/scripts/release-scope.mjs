// Prints what a release from develop into main would carry, for the release
// skill. The first release after the scripted-model chain carried about 95
// PRs, not the chain's five: nothing said main had not moved since #478, the
// body was built from `git log` by hand and its first draft left out #533 and
// #496, and the release PR's own checks were Railway's develop deploys, since
// its head is the `[skip ci]` version bump.
//
// Reads origin/main and origin/develop as they are; fetch first. One block
// out, and the exit code carries the verdict:
//   0  ready      something to release, and CI is green at develop's last
//                 commit that ran it
//   1  not ready  nothing to release, or that CI run is red, running or missing
//
// Usage: node .claude/scripts/release-scope.mjs
import { spawnSync } from "node:child_process";

const BASE = "origin/main";
const HEAD = "origin/develop";

// Paths whose change a release must name, because a deploy acts on them
// rather than just running new code: deployment.md has why each matters.
const DEPLOY_RISKS = [
  ["migrations", /^apps\/api\/prisma\/migrations\/.+\.sql$/],
  ["images", /(^|\/)(Dockerfile[^/]*|Caddyfile|railway[^/]*\.json|\.dockerignore)$/],
  ["env templates", /(^|\/)\.env[^/]*\.example$/],
  ["lockfile", /^bun\.lock$/],
];

const VERSION_BUMP = /^chore\(web\): bump version to .* \[skip ci\]$/;

function run(command, args) {
  const { stdout, stderr, status, error } = spawnSync(command, args, { encoding: "utf8" });
  if (error || status !== 0) {
    throw new Error(`${command} ${args.join(" ")}: ${error?.message ?? stderr.trim()}`);
  }
  return stdout;
}

const git = (...args) => run("git", args);
const lines = (text) => text.split("\n").filter((line) => line.length > 0);

/** The file at `ref`, or null when it does not exist there. */
function fileAt(ref, path) {
  const { stdout, status } = spawnSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  return status === 0 ? stdout : null;
}

const versionAt = (ref) => JSON.parse(fileAt(ref, "apps/web/package.json") ?? "{}").version;

/** A package.json whose change is more than the version bump develop makes on every merge. */
function changedBeyondVersion(path) {
  const strip = (text) => {
    if (text === null) return null;
    const { version: _version, ...rest } = JSON.parse(text);
    return JSON.stringify(rest);
  };
  return strip(fileAt(BASE, path)) !== strip(fileAt(HEAD, path));
}

/** Merged PRs' titles by number: a merge commit's body holds its PR's title only sometimes. */
function prTitles() {
  const prs = JSON.parse(
    run("gh", [
      "pr", "list", "--state", "merged", "--base", "develop",
      "--limit", "400", "--json", "number,title",
    ]),
  );
  return new Map(prs.map((pr) => [String(pr.number), pr.title]));
}

/** Each commit on develop's first parent since main: merges as their PRs, the rest as they are. */
function commits() {
  const titles = prTitles();
  const records = git(
    "log",
    "--first-parent",
    "--reverse",
    "--format=%h%x1f%s%x1f%b%x1e",
    `${BASE}..${HEAD}`,
  )
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => record.split("\x1f"));
  const merges = [];
  const direct = [];
  for (const [sha, subject, body = ""] of records) {
    const merge = /^Merge pull request #(\d+) from [^/]+\/(\S+)/.exec(subject);
    if (merge) {
      const title = titles.get(merge[1]) ?? (body.split("\n")[0]?.trim() || "(no title)");
      merges.push(`#${merge[1]} ${title}  [${merge[2]}]`);
    } else if (!VERSION_BUMP.test(subject)) {
      direct.push(`${sha} ${subject}`);
    }
  }
  return { merges, direct };
}

/** CI on develop's last first-parent commit that ran it: the bumps skip it. */
function ciVerdict() {
  const tested = lines(git("log", "--first-parent", "--format=%H%x1f%s", "-50", HEAD))
    .map((line) => line.split("\x1f"))
    .find(([, subject]) => !subject.includes("[skip ci]"));
  if (!tested) return [false, "CI: no commit in develop's last 50 ran CI"];
  const [sha] = tested;
  const [latest] = JSON.parse(
    run("gh", [
      "run", "list", "--workflow", "ci.yml", "--commit", sha,
      "--json", "status,conclusion,url", "--limit", "1",
    ]),
  );
  const short = sha.slice(0, 7);
  if (!latest) return [false, `CI: no run at ${short}`];
  if (latest.status !== "completed") return [false, `CI: ${latest.status} at ${short} ${latest.url}`];
  const green = latest.conclusion === "success";
  return [green, `CI: ${green ? "green" : latest.conclusion} at ${short} ${latest.url}`];
}

const changed = lines(git("diff", "--name-only", `${BASE}...${HEAD}`));
const { merges, direct } = commits();
const [green, ci] = ciVerdict();

const out = [
  `Release ${HEAD} -> ${BASE}: ${versionAt(BASE)} -> ${versionAt(HEAD)}` +
    ` (main ${git("rev-parse", "--short", BASE).trim()}, develop ${git("rev-parse", "--short", HEAD).trim()})`,
  ci,
  `Merged PRs (${merges.length}):`,
  ...merges.map((merge) => `  ${merge}`),
];
if (direct.length > 0) {
  out.push(`Commits on develop outside a PR (${direct.length}):`, ...direct.map((c) => `  ${c}`));
}
out.push("Deploy risks:");
const packages = changed.filter((path) => /(^|\/)package\.json$/.test(path) && changedBeyondVersion(path));
for (const [name, pattern] of [...DEPLOY_RISKS, ["package.json beyond the version", null]]) {
  const hits = pattern === null ? packages : changed.filter((path) => pattern.test(path));
  out.push(`  ${name}: ${hits.length === 0 ? "none" : hits.join(", ")}`);
}
process.stdout.write(out.join("\n") + "\n");
process.exit(green && merges.length + direct.length > 0 ? 0 : 1);
