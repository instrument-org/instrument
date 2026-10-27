import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { APP_NAME } from "@instrument-org/shared";

import { APP_COMMAND } from "./shell-commands/app-command";
import { webInsteadCommand, webInsteadStep } from "./apps/web-instead";
import {
  signInProgressLine,
  signInsSettled,
} from "./sign-in-progress-model-text";
import { systemNote } from "./system-note";

/**
 * The note about an app: on its own, it wakes the chat that asked, because
 * the user finished a sign-in, saved a key, or declined, and says what to do
 * next, since nobody typed anything; carried on a message the user wrote, it
 * says what changed outside the conversation, and only that. Where the
 * session was last told another computer's connections, it also tells which
 * apps are connected on this one, from the apps the note saved.
 */
export function appEventModelNote(
  data: SessionMessageDataPart.AppEventDataPart,
) {
  const lines = data.events.map((event) => {
    // The detail is a sentence of the app's own where it has one, so the
    // period the clause around it ends with is already there.
    const detail = event.detail?.replace(/\.$/, "");
    switch (event.event) {
      case "added": {
        return `- ${event.name} (${event.slug}) was set up outside this conversation, so your list of apps does not show it. \`${APP_COMMAND.name} list\` says where it stands.`;
      }
      case "changed": {
        return `- ${event.name} (${event.slug}) was changed outside this conversation: what you read of its setup or guide is out of date.`;
      }
      case "connected": {
        if (event.web !== undefined) {
          return `- The user says they are signed in to ${event.name} (${event.slug}) on the web, in ${APP_NAME}'s browser. It is connected. Work it there: open ${event.web} in a tab, where the sign-in holds, or use a tab already open there. No \`${APP_COMMAND.name}\` call reaches it.${nameIt(event)}`;
        }
        return `- The user signed in to ${event.name} (${event.slug}). It is connected${detail ? `: ${detail}` : ""}. Use it now: \`${APP_COMMAND.name} tools ${event.slug}\`, then \`${APP_COMMAND.name} call\`.${nameIt(event)}`;
      }
      case "declined": {
        return `- The user declined to connect ${event.name} (${event.slug}). Do not ask again unless they bring it up; say what you cannot do without it, in a line, and carry on with what you can.`;
      }
      case "disconnected": {
        return event.web === undefined
          ? `- ${event.name} (${event.slug}) was disconnected. Its tools and requests will refuse until it is connected again.`
          : `- ${event.name} (${event.slug}) was disconnected. Do not work its site until the user signs in again.`;
      }
      case "failed": {
        if (event.signIn !== undefined) {
          return signInEnded(event, event.signIn, detail);
        }
        return `- Connecting ${event.name} (${event.slug}) failed${detail ? `: ${detail}` : ""}. Read \`${APP_COMMAND.name} list\`, fix what you can, and tell the user in a line what happened.`;
      }
      case "removed": {
        return `- ${event.name} (${event.slug}) was removed: its folder is gone along with its sign-in or key. Set it up again with \`${APP_COMMAND.name} new\` only if the user asks for it.`;
      }
    }
  });

  const said = [
    ...(lines.length === 0
      ? []
      : [lines.length === 1 ? "An app changed:" : "Apps changed:", ...lines]),
    ...(data.otherComputer ? onThisComputer(data.apps) : []),
    ...(data.signIns === undefined ? [] : [signInCardLine(data.signIns)]),
    ...(data.notOnCard === undefined ? [] : notOnCardLines(data.notOnCard)),
    data.carried
      ? lines.length === 0
        ? "It is only so you know: answer what the user wrote."
        : "This changed outside the conversation since your last turn. It is only so you know: answer what the user wrote."
      : "Nobody typed anything; this note is why you are awake. Tell the user in one line where things stand, and finish what they asked for if it was waiting on this.",
  ];

  return systemNote`
    ${said.join("\n")}
  `;
}

type AppEventLine = SessionMessageDataPart.AppEventDataPart["events"][number];

/**
 * The apps the card's call named that never got a row on it, which the user
 * may take as handled unless the reply says otherwise.
 */
function notOnCardLines(notOnCard: SessionMessageDataPart.NotOnCard): string[] {
  return [
    `Never on the card, so not connected: ${notOnCard.length === 1 ? "an app" : "apps"} your connect_app call named that could not be asked for:`,
    ...notOnCard.map(({ reason, slug }) => `- ${slug}: ${reason}`),
    "Your reply names each of these as not connected and says what it needs, beside what the card settled; the user has not seen this.",
  ];
}

/**
 * The card a note's app was asked for on with others: once every app on it
 * is answered, that this is the card's one note; before, where it stands.
 */
function signInCardLine(
  progress: SessionMessageDataPart.SignInProgress,
): string {
  return signInsSettled(progress)
    ? `Every app on your sign-in card is answered, and this is the one note it sends: ${signInProgressLine(progress)} Answer it in one message: which apps are connected, as which account where it is named, and which the user skipped.`
    : `Your sign-in card as it stands: ${signInProgressLine(progress)} The card shows the user the count, so leave it out; you are woken once more when no app on it is waiting.`;
}

/**
 * A sign-in of the app's own that did not connect, and the way on from it:
 * the web, where the service's own sign-in page works in the window's
 * browser. A refusal or a failure goes there; a sign-in the user stopped or
 * left to lapse may only want another try, which the card offers beside it.
 */
function signInEnded(
  { name, slug }: AppEventLine,
  { ended, web }: NonNullable<AppEventLine["signIn"]>,
  detail: string | undefined,
): string {
  const said = detail ? `: ${detail}` : "";
  switch (ended) {
    case "canceled":
    case "expired": {
      const what =
        ended === "canceled"
          ? `The user stopped signing in to ${name} (${slug}) before it finished.`
          : `The sign-in to ${name} (${slug}) was left unfinished and lapsed.`;
      return `- ${what} The card offers signing in on the web or trying again; ask which in a line. For the web: \`${webInsteadCommand(slug, web)}\`, then connect_app. To try again: connect_app as it is.`;
    }
    case "failed": {
      return `- Signing in to ${name} (${slug}) failed${said}. ${webInsteadStep(slug, web)}`;
    }
    case "refused": {
      return `- ${name} (${slug}) refused to connect this account directly${said}. That is the service's rule, not the user declining, and trying the same sign-in again meets it again. ${webInsteadStep(slug, web)}`;
    }
  }
}

/**
 * Each app's connection on this computer, for a session last told another
 * computer's: a key or sign-in stays on the computer it was given on.
 */
function onThisComputer(
  apps: SessionMessageDataPart.AppEventDataPart["apps"],
): string[] {
  const named = (connected: boolean) =>
    Object.entries(apps)
      .filter(([, app]) => app.connected === connected)
      .map(([slug, app]) => `${app.name} (${slug})`)
      .join(", ");
  const connected = named(true);
  const not = named(false);
  return [
    "You were last told about apps on another computer. Each computer has its own sign-ins and keys; on this one:",
    `- Connected: ${connected || "none"}.`,
    ...(not ? [`- Not connected here: ${not}.`] : []),
  ];
}

/**
 * Whose account the app is signed in as, when someone named it, or what a
 * connection note asks of the agent when nobody has.
 */
function nameIt({ account, slug }: { account?: string; slug: string }): string {
  if (account !== undefined) {
    return ` It is signed in as ${account}.`;
  }
  return ` If its account is plain (the page you are on shows it, or the user said it), name it: \`${APP_COMMAND.name} account ${slug} '<account>'\`. Don't hunt for it.`;
}
