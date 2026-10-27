import { APP_MANIFEST_EXAMPLE } from "../apps/manifest";
import { generatedCommand } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { scriptSurfaceOpen } from "../capabilities/script-surface";
import { APP_COMMAND } from "./app-command";
import { NODE_COMMAND } from "./node";

export { APP_COMMAND } from "./app-command";

/** What `app` needs from the `bash` call it runs inside: its chat, session, model and role. */
export type AppCommandContext = CapabilityScope;

/** The usage's lines on scripts, where a script reaches `instrument`. */
const SCRIPTS_USAGE = `  In a script, the same calls return values, and a refusal throws. In
  ${NODE_COMMAND.name} code, the \`instrument\` global: \`await instrument.apps["<slug>"].<tool>({...})\`,
  \`await instrument.apps["<slug>"].get("<path>", { params })\` (\`post\`, \`put\`, \`patch\`,
  \`delete\` take \`{ body }\`). In Python, \`import instrument\`: \`instrument.app("<slug>").<tool>(...)\`,
  \`instrument.app("<slug>").get("<path>", params={...})\`, \`.post("<path>", body={...})\`.
  For many calls, or calls that feed each other, in one script rather than a
  turn each. Read an app's guide with \`${APP_COMMAND.name} guide <slug>\` before scripting
  it: a script's first request to an API app throws ReadGuideFirst with the
  guide instead of sending. Setting an app up is here in the shell only.`;

/** The command's usage, every subcommand's lines generated from the registry. */
function appUsage(generated: string[]) {
  return `Usage: ${APP_COMMAND.name} <subcommand> ...

  Every subcommand takes --json, for the whole result as JSON, and --out <file>, to write it there.
${generated.join("\n")}
${scriptSurfaceOpen() ? `${SCRIPTS_USAGE}\n` : ""}
${APP_MANIFEST_EXAMPLE}
`;
}

/** `instrument app`: its subcommands are the registry's `apps.*` capabilities. */
export function createAppCommand(context: AppCommandContext) {
  return generatedCommand({
    name: APP_COMMAND.name,
    scope: context,
    usage: appUsage,
    word: APP_COMMAND.word,
  });
}
