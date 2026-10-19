import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument x` command, kept apart
 * from the command itself so prompt text can name it without importing the
 * workspace machinery the command runs against.
 */
export const X_COMMAND = {
  description:
    "Searches posts on X (Twitter) through the user's Grok account, whatever model you run on: `instrument x search \"<query>\"`, with `--from <handle>` for one account's posts and `--since`/`--until YYYY-MM-DD`. It prints the posts themselves, each with its author, date, words and link, which x.com shows only to a signed-in browser. A shell command, not a skill. When it fails it says why (no Grok account, a usage limit, a refusal), which is what to tell the user.",
  name: `${INSTRUMENT_COMMAND.name} x`,
  summary: "Search posts on X through the user's Grok account.",
  word: "x",
} as const;
