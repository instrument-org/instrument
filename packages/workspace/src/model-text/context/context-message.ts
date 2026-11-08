import { dedent } from "radashi";

import { getCurrentDate } from "../../lib/get-current-date";
import { NODE_COMMAND } from "../../lib/shell-commands/node";
import { PYTHON_COMMAND } from "../../lib/shell-commands/python";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { TOOL_NAMES } from "../../tools/name";
import { contextDateKey, formatContextDate } from "../../lib/context-date";
import {
  computerToolsText,
  folderVariablesText,
  platformGuidance,
  timeZoneRegion,
} from "./environment-model-text";
import { type Environment } from "../../schemas/environment";

/** The folders list's opening line, when the conversation reaches any. */
export const FOLDERS_INTRO =
  "These are the user's folders this conversation reaches: their home folder, the Instrument folder this conversation's own folder is in, and any folder they sent, allowed, or filed the conversation's project with:";

/** What the context message says in place of the folders list, when there is none. */
export const NO_FOLDERS_TEXT = `You reach none of the user's folders yet. Reaching for one shows the person a card; folders allowed later are announced on the message they arrive with.`;

/** What reaches the network from the agent's shell and tools, for `getSystemInfoText`. */
export function networkText(): string {
  return `\`curl\` and \`${TOOL_NAMES.webFetch}\` reach the internet and the local network. \`${NODE_COMMAND.name}\` and \`${PYTHON_COMMAND.name}\` are real programs on this computer, with its network.`;
}

/**
 * The computer the session starts on, as the context message tells it.
 * `network` names what reaches the network from the agent's shell and tools.
 */
export function getSystemInfoText({
  environment,
  network,
}: {
  environment: Environment;
  network: string;
}) {
  const now = getCurrentDate();
  const guidance = platformGuidance(environment.platform);
  return dedent`
    <system_info>
    The user's computer: ${environment.computer}. You run on it: their files and apps belong to this system, and so does anything you write for them to run.${guidance === undefined ? "" : ` ${guidance}`}
    Your shell: an emulated POSIX shell with GNU coreutils spellings, whatever the user's computer is. Reach for \`stat -c\`, \`date -d\`, and \`sed -i\` with no backup suffix; the BSD forms (\`stat -f\`, \`date -r\`, \`sed -i ''\`) do not exist here. ${network}
    ${folderVariablesText(environment)}
    ${computerToolsText(environment)}
    Current date: ${formatContextDate(contextDateKey(now))} -- the day this session started. A session that runs past midnight is told the new date on the turn it happens; until then, this is today.
    Time zone: ${timeZoneRegion(environment.timeZone)}, the computer's and so a fair guide to the region the user is in. This session started at ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} local time; \`date\` in your shell gives the time now.
    </system_info>
  `.trim();
}

/**
 * Who the agent is working for, when someone is signed in: their name when
 * the account gives one, so a reply can address them and a service reached
 * under their account is read as theirs, and the email that account goes by. Nothing while signed out,
 * and nothing when the account cannot be read, since a guessed name is worse
 * than none. A startup snapshot like the rest of the context, so a session
 * opened before a sign-in never learns the name.
 */
export async function getUserText(): Promise<string | undefined> {
  const user = await getWorkspaceConfig().getUser?.();
  if (!user) {
    return undefined;
  }
  return user.name
    ? `The user's name is ${user.name}, signed in as ${user.email}.`
    : `The user is signed in as ${user.email}.`;
}
