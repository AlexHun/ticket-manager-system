// PreToolUse guard: refuses to read or write a local env file. apps/api/.env
// and its siblings hold live secrets (the OpenAI key, BETTER_AUTH_SECRET,
// DATABASE_URL, the Postmark tokens), and a file the agent reads is sent to the
// API and kept in the session transcript. Exit 2 blocks the call and hands
// stderr to Claude as the reason.
//
// "Env file" is what .gitignore says it is: `.env` and `.env.*`, minus the
// committed `*.example` templates, which hold names and no values. Matched
// case-insensitively, since `.ENV` opens the same file on Windows, and with a
// trailing wildcard, since `.env*` expands to `.env` itself.
//
// Grep is checked only for an explicit path. A directory search skips the env
// files on its own: it honours .gitignore, and a glob does not override that
// (checked 2026-10-15: `DATABASE_URL` over apps/api listed the three
// `.example` templates and none of the real files).
//
// The shell check catches the accidental read (`cat apps/api/.env`), not a
// determined one: a command that reads the file through a script it wrote
// first is out of reach of any pattern here.
import { readFileSync } from "node:fs";

const { tool_name, tool_input } = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, ""));

const isEnvFile = (path) => {
  const name = (path.replaceAll("\\", "/").split("/").pop() ?? "").toLowerCase();
  return /^\.env(?:$|[.*?[])/.test(name) && !name.endsWith(".example");
};

const fileArg =
  tool_name === "Grep"
    ? tool_input?.path
    : tool_name === "Read" || tool_name === "Edit" || tool_name === "Write"
      ? tool_input?.file_path
      : null;
let target = fileArg && isEnvFile(fileArg) ? fileArg : null;

if (tool_name === "Bash" || tool_name === "PowerShell") {
  // Per statement, so `test -f .env && cat .env` is caught and
  // `cp .env.example .env` is not: a statement that prints file contents and
  // names an env file. Pipes stay inside a statement, so
  // `gci -Filter .env* | gc` counts as one.
  const readers =
    /\b(?:cat|type|head|tail|less|more|bat|sed|awk|grep|rg|findstr|strings|gc|Get-Content|Select-String|sls)\b/i;
  const paths = /[^\s"'`;|&<>()]*\.env[\w.*?[\]-]*/gi;
  for (const statement of (tool_input?.command ?? "").split(/\r?\n|;|&&|\|\|/)) {
    const hit = statement.match(paths)?.find(isEnvFile);
    if (hit && readers.test(statement)) {
      target = hit;
      break;
    }
  }
}

if (target) {
  process.stderr.write(
    `Blocked: ${target} is a local env file and holds live secrets; its contents would ` +
      "land in the transcript. Read the matching .env.example for the variable names, " +
      "or ask the user for the one value you need.\n",
  );
  process.exit(2);
}
