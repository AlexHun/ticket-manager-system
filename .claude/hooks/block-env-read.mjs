// PreToolUse guard: refuses to read or write a local env file. apps/api/.env
// and its siblings hold live secrets (the OpenAI key, BETTER_AUTH_SECRET,
// DATABASE_URL, the Postmark tokens), and a file the agent reads is sent to the
// API and kept in the session transcript. Exit 2 blocks the call and hands
// stderr to Claude as the reason.
//
// "Env file" is what .gitignore says it is: `.env` and `.env.*`, minus the
// committed `*.example` templates, which hold names and no values.
//
// The shell check catches the accidental read (`cat apps/api/.env`), not a
// determined one: a command that reads the file through a script it wrote
// first is out of reach of any pattern here.
import { readFileSync } from "node:fs";

const { tool_name, tool_input } = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, ""));

const isEnvFile = (path) => {
  const name = path.replaceAll("\\", "/").split("/").pop() ?? "";
  return (name === ".env" || name.startsWith(".env.")) && !name.endsWith(".example");
};

let target = null;

if (tool_name === "Read" || tool_name === "Edit" || tool_name === "Write") {
  if (isEnvFile(tool_input?.file_path ?? "")) target = tool_input.file_path;
} else if (tool_name === "Grep") {
  if (isEnvFile(tool_input?.path ?? "")) target = tool_input.path;
  else if (
    /(?:^|[\\/{,*])\.env\b/.test(tool_input?.glob ?? "") &&
    !tool_input.glob.endsWith(".example")
  )
    target = tool_input.glob;
} else {
  // Bash and PowerShell: a command that prints file contents, followed later on
  // the same line by an env-file path. `cp .env.example .env` and `Test-Path`
  // pass, since neither prints a value.
  const command = tool_input?.command ?? "";
  const readers =
    /\b(?:cat|type|head|tail|less|more|bat|sed|awk|grep|rg|findstr|strings|gc|Get-Content|Select-String|sls)\b/i;
  const envPaths = command.match(/[^\s"'`;|&<>()]*\.env(?:\.[\w.-]+)?(?=$|[\s"'`;|&<>)])/g) ?? [];
  const hit = envPaths.find(
    (path) => isEnvFile(path) && readers.test(command.slice(0, command.indexOf(path))),
  );
  if (hit) target = hit;
}

if (target) {
  process.stderr.write(
    `Blocked: ${target} is a local env file and holds live secrets; its contents would ` +
      "land in the transcript. Read the matching .env.example for the variable names, " +
      "or ask the user for the one value you need.\n",
  );
  process.exit(2);
}
