import { type Bash } from "just-bash";
import { z } from "zod";

import { AGENT_BROWSER_GUIDE_NAME } from "../../model-text/guides/agent-browser-guide";
import { asScriptCall } from "../shell-commands/agent-browser-follow-up";
import { type CapabilityScope } from "./context";
import { CapabilityFailure, CommandFailure, defineCapability } from "./define";

const NAME = AGENT_BROWSER_GUIDE_NAME;

/**
 * How a bash call's scripts run `agent-browser`: as one command in a shell
 * built from the bash call's own options, with the script's words as its
 * argv, never parsed as shell text. The shell's command is the only thing
 * that runs, so its flag policy, its folder rules, the chat's tabs and the
 * session it drives them as are the ones a typed command gets, and so is
 * everything it records about the call.
 */
export function browserThrough(
  shell: () => Promise<Pick<Bash, "exec">>,
): NonNullable<CapabilityScope["runBrowser"]> {
  return async ({ args, from, signal, stdin }) => {
    const { exitCode, stderr, stdout } = await (
      await shell()
    ).exec(NAME, {
      args,
      ...(from === undefined
        ? {}
        : { cwd: from.cwd, env: from.env, replaceEnv: true }),
      ...(signal === undefined ? {} : { signal }),
      ...(stdin === undefined ? {} : { stdin }),
    });
    return { exitCode, stderr, stdout };
  };
}

/**
 * `agent-browser` from a script: the command's words in, what it printed
 * out, and a failure that carries its status and both streams. What the
 * shell's command adds for the model (the page after, a screenshot, who
 * else used the tab) is left for the end of the bash call, once.
 */
export const browserRun = defineCapability({
  name: "browser.run",
  summary: `One ${NAME} command in this chat's tabs, as the shell runs it: what it printed.`,
  input: z.object({
    args: z
      .array(z.string())
      .min(1, `${NAME} takes a command: instrument.browser("open", url).`)
      .describe(
        `The command's words, as after \`${NAME}\` in the shell: ["open", url].`,
      ),
    stdin: z
      .string()
      .optional()
      .describe("What the command reads on stdin, as `eval --stdin` does."),
  }),
  output: z.string(),
  surfaces: { script: { positional: ["args"] } },
  run: async ({ args, stdin }, ctx) => {
    const { browser } = ctx;
    if (browser === undefined) {
      throw new CapabilityFailure(
        `no shell is behind this call, so there is no ${NAME} to run.`,
      );
    }
    const end = await asScriptCall(() => browser(args, stdin));
    if (end.exitCode !== 0) {
      throw new CommandFailure(
        end.stderr.trim() ||
          end.stdout.trim() ||
          `${NAME} ${args[0] ?? ""} exited ${end.exitCode} and printed nothing.`,
        end,
      );
    }
    return end.stdout;
  },
  text: (output) => output,
});
