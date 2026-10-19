import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument x` command, kept apart
 * from the command itself so prompt text can name it without importing the
 * workspace machinery the command runs against.
 */
export const X_COMMAND = {
  description:
    "Searches posts on X (Twitter) through the user's Grok account, whatever model you run on: `instrument x search \"<words>\"` for posts about something, `--from <handle>` alone for an account's latest, `--since`/`--until YYYY-MM-DD`, `--limit <n>`, and `--json` for the posts as data (handle, date, text, url) to pipe or save. It prints the posts themselves, which x.com shows only to a signed-in browser. A shell command, not a skill; `instrument x search --help` has the rest. When it fails it says why (no Grok account, a usage limit, a refusal), which is what to tell the user.",
  name: `${INSTRUMENT_COMMAND.name} x`,
  summary: "Search posts on X through the user's Grok account.",
  word: "x",
} as const;
