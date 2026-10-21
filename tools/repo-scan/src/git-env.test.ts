import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
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

  test("drops each of them and keeps everything else", () => {
    const named = Object.fromEntries(
      GIT_LOCAL_ENV.map((name) => [name, "/elsewhere/.git"]),
    );
    const free = repositoryFreeEnv({ ...named, PATH: "/bin", HOME: "/home" });

    expect(free).toEqual({ PATH: "/bin", HOME: "/home" });
  });

  test("leaves the environment it was given alone", () => {
    const env = { GIT_DIR: "/elsewhere/.git" };
    repositoryFreeEnv(env);

    expect(env).toEqual({ GIT_DIR: "/elsewhere/.git" });
  });
});
