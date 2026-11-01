import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_LOCAL_ENV, repositoryFreeEnv } from "./git-env.ts";

describe("repositoryFreeEnv", () => {
  test("removes every variable this machine's git says ties it to one repository", () => {
    // The list is written out rather than asked for on every call, so a git
    // that adds a variable leaves it short. This is where that shows
    // (`docs/prd/one-repo-scanner.md`, R3).
    const listed = execFileSync("git", ["rev-parse", "--local-env-vars"], {
      env: repositoryFreeEnv(),
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean);

    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((name) => !GIT_LOCAL_ENV.includes(name))).toEqual([]);
  });

  test("drops each of them, turns optional locks off and keeps everything else", () => {
    const named = Object.fromEntries(
      GIT_LOCAL_ENV.map((name) => [name, "/elsewhere/.git"]),
    );
    const free = repositoryFreeEnv({ ...named, PATH: "/bin", HOME: "/home" });

    expect(free).toEqual({
      PATH: "/bin",
      HOME: "/home",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });

  test("lets a git status leave the index unwritten, so it takes no index.lock (#631)", () => {
    // A status that finds stale stat data rewrites the index under
    // index.lock, and one killed while it writes leaves the lock behind.
    const repo = mkdtempSync(join(tmpdir(), "git-env-"));
    try {
      const git = (env: NodeJS.ProcessEnv, ...args: string[]) =>
        execFileSync("git", args, { cwd: repo, env, stdio: "ignore" });
      git(repositoryFreeEnv(), "init", "-q");
      writeFileSync(join(repo, "a.txt"), "a\n");
      git(repositoryFreeEnv(), "add", "a.txt");
      git(
        repositoryFreeEnv(),
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-qm",
        "a",
      );
      const index = join(repo, ".git", "index");
      let year = 2020;
      const statusAfterTouch = (env: NodeJS.ProcessEnv) => {
        const before = readFileSync(index);
        // A time no earlier status has recorded, so the stat data is stale.
        const touched = new Date(year++, 0, 1);
        utimesSync(join(repo, "a.txt"), touched, touched);
        git(env, "status", "--porcelain");
        return readFileSync(index).equals(before);
      };

      // The same status with optional locks allowed does rewrite it, so the
      // touch makes the index stale and the check below can fail.
      expect(
        statusAfterTouch({ ...repositoryFreeEnv(), GIT_OPTIONAL_LOCKS: "1" }),
      ).toBe(false);
      expect(
        statusAfterTouch(
          repositoryFreeEnv({ ...process.env, GIT_OPTIONAL_LOCKS: "1" }),
        ),
      ).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("leaves the environment it was given alone", () => {
    const env = { GIT_DIR: "/elsewhere/.git" };
    repositoryFreeEnv(env);

    expect(env).toEqual({ GIT_DIR: "/elsewhere/.git" });
  });
});
