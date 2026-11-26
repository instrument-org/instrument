import { APP_NAME } from "@instrument-org/shared";
import { TOOL_NAMES } from "../../tools/name";
import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument app` command, kept apart from the
 * command itself so prompt text and model notes can name it without importing
 * the workspace machinery the command runs against.
 */
export const APP_COMMAND = {
  description:
    "Reach the services connected to this workspace: look one up in the directory, set it up, test it until it connects, then list and call its tools or make requests. `instrument app help` prints the full surface.",
  name: `${INSTRUMENT_COMMAND.name} app`,
  summary: "Connect services and call their tools.",
  word: "app",
} as const;

/** How a task hands on an app that needs setting up, connecting or changing. */
const NAME_IT_IN_YOUR_NEEDS =
  "End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.";

/**
 * What a task is told about an app it cannot use until it is set up or the
 * user connects it: every chat uses the workspace's apps, so only the chat
 * the person talks to changes them and asks for a sign-in or a key.
 */
export const APPS_ARE_THE_CHATS = `Setting up and connecting apps is the chat's. ${NAME_IT_IN_YOUR_NEEDS}`;

/** Why a task's setup word changes nothing. */
export const APP_SETUP_IS_THE_CHATS = `only the chat sets up and changes apps, since every chat uses them. ${NAME_IT_IN_YOUR_NEEDS}`;

/**
 * A web app with no sign-in recorded on this computer, in the list every
 * chat starts with and for a task: where it stands, leaving what to do about
 * it to the work that needs the app.
 */
export const WEB_APP_UNMARKED = `not checked on this computer yet: the user may already be signed in on the site in ${APP_NAME}'s browser`;

/**
 * The same, for the chat about to use it: nothing sees a session in the
 * browser, so the page the site loads says whether the user is signed in,
 * and a card is for a site that loads signed out.
 */
export const WEB_APP_NOT_SIGNED_IN = `not checked on this computer yet. Open its site in a tab and look: if it loads signed in, call ${TOOL_NAMES.connectApp} with it in \`signedIn\`, which records that and shows no card, and carry on there; if it loads signed out, ask with ${TOOL_NAMES.connectApp}`;
