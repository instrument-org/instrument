import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument x` command, kept apart
 * from the command itself so prompt text can name it without importing the
 * workspace machinery the command runs against.
 */
export const X_COMMAND = {
  description:
    "Reads X (Twitter) through the user's Grok account, whatever model you run on: `instrument x search \"<words>\"` for posts about something (X's search operators work too), `--from <handle>` alone for an account's latest, `instrument x thread <post url>` for the conversation around a post, and `--json` on either for the posts as data (handle, date, text, url) to pipe or save. It prints the posts themselves, which x.com shows only to a signed-in browser. A shell command, not a skill; `instrument x --help` has every flag. When it fails it says why (no Grok account, a usage limit, a refusal), which is what to tell the user.",
  name: `${INSTRUMENT_COMMAND.name} x`,
  summary: "Search posts on X through the user's Grok account.",
  word: "x",
} as const;
