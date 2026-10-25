// How Claude Code records a command typed at the prompt: `<command-name>`,
// `<command-message>` and `<command-args>` in either order, the args
// sometimes left out (#616). The one reading of it the Sessions page's title,
// chain view and `implement` step share (#682).

/** A prompt that is a typed command opens on one of its tags; one that only
 *  quotes the markup further in, as a `!` command's output or a prompt about
 *  the markup can, is not one. */
const COMMAND_PROMPT = /^\s*<command-(?:name|message)>/;
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/** The command a prompt typed and its arguments, an empty string for none, or
 *  null for a prompt that is not a typed command. */
export function commandOf(text: string): { name: string; args: string } | null {
  if (!COMMAND_PROMPT.test(text)) return null;
  const name = COMMAND_NAME.exec(text)?.[1]?.trim();
  if (!name) return null;
  return { name, args: COMMAND_ARGS.exec(text)?.[1]?.trim() ?? "" };
}
