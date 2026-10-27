import { type ToolResultPart } from "ai";
import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { APP_FILE_NAME } from "../lib/apps/app-file";
import {
  isConnected,
  readConnection,
  recordConnection,
} from "../lib/apps/connection";
import { describeLocalLaunch } from "../lib/apps/mcp/local-server";
import { appSiteFor } from "../lib/apps/site";
import {
  guidePlaceholdersLeft,
  loadApp,
  readAppGuide,
} from "../lib/apps/store";
import { APP_COMMAND } from "../lib/shell-commands/app-command";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { shellPath } from "../lib/workspace-fs-layout";
import { type ChatId } from "../schemas/chat-id";
import {
  type ConnectAppResult,
  askedOnCard,
  ConnectAppOutputSchema,
  connectAppResults,
} from "./connect-app-output";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";

// A task runs the chat's agent where no card is seen.
const ROLE_REFUSAL =
  "You are running in the background, where nobody sees a card: only the chat asks the user to connect an app. End your last message with a needs fence naming the app.";

/** The most apps one card asks for. */
const MAX_APPS_PER_CARD = 12;

/**
 * Ask the user for the one thing only they can give each of a few apps: a
 * sign-in, or a key. Not an interactive call: it puts one card in the
 * conversation, a row per app, and returns at once, so the turn ends and the
 * user can keep talking. What they do on the card reaches the agent later as
 * one app note once every row is answered (`lib/apps/events.ts`), the way a
 * finishing task does, and the credential itself never passes through the
 * model.
 */
const connectAppCapability = defineCapability({
  input: z.object({
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence, addressed to the user, saying what connecting them lets you do for them: 'So I can read and write your Notion pages.'",
    }),
    slugs: z
      .array(z.string())
      .min(1)
      .max(MAX_APPS_PER_CARD)
      .meta({
        description: `The apps to connect: the \`id\` in the ${APP_FILE_NAME} you have already written for each. Every app the work needs goes in one call, one card for them all.`,
      }),
  }),
  name: "apps.connect",
  summary: "Asks the person to connect apps on one card; the turn ends on it.",
  surfaces: {
    tool: {
      description: dedent`
    Ask the user to connect apps whose folders you have written in the apps folder. One card appears in the conversation with a row for each app and a count of how many are connected: a sign-in button for an OAuth app, a secure field for a key, for an app whose server runs on this machine, what would run and a button to allow it, and for a web app, a button that opens its sign-in in the window's browser. Name every app the work needs in one call: several calls make several cards. It returns at once; say one line and end your turn. You are woken once, with a note, when the user has answered every row: signed in, saved a key, or declined. Never ask for a key in prose instead.
  `,
      execute: async ({ input, chatId }) => {
        const slugs = [...new Set(input.slugs)];
        const apps: ConnectAppResult[] = [];
        // One at a time: each ask writes the app's connection record.
        for (const slug of slugs) {
          apps.push(await askFor(slug, chatId));
        }
        return ok({ apps });
      },
      readOnly: false,
      timeoutMs: () => ms("10 seconds"),
      toModelOutput: ({ output }) => {
        const results = connectAppResults(output);
        const [only] = results;
        if (only !== undefined && results.length === 1) {
          return oneAppModelOutput(only);
        }
        return cardModelOutput(results);
      },
      name: "connect_app",
      output: ConnectAppOutputSchema,
    },
  },
  where: {
    roles: ["chat"],
    roleRefusal: ROLE_REFUSAL,
  },
});

export const ConnectApp = modelTool(connectAppCapability);

/** What asking for one app comes to: a row on the card, already connected, or why it could not be asked. */
async function askFor(
  requested: string,
  chatId: ChatId,
): Promise<ConnectAppResult> {
  const config = getWorkspaceConfig();
  const loaded = await loadApp(config.appsDir, requested);
  if (loaded.isErr()) {
    return {
      message: `${loaded.error.message} Write the app's folder first (\`${APP_COMMAND.name} new\`), then ask.`,
      slug: requested,
      state: "failure",
    };
  }
  const { dir, manifest, manifestHash, name, slug } = loaded.value;
  // Asking again would set a working connection back to waiting, for every
  // chat that uses it.
  const connection = await readConnection(slug);
  if (isConnected(connection, manifestHash)) {
    return { name, slug, state: "connected" };
  }
  // The test that runs once the user has acted fails on an API app's
  // unwritten guide, so a card asked for before it is written puts that
  // failure in front of the user, after their click, as something they
  // cannot fix.
  const guide = await readAppGuide(dir);
  const unanswered =
    guide === null ? [] : guidePlaceholdersLeft(manifest, guide);
  if (manifest.type === "api" && (guide === null || unanswered.length > 0)) {
    const write = `Write it yourself with \`${APP_COMMAND.name} guide ${slug} <<'EOF'\` (the whole file on stdin), then ask again.`;
    return {
      message:
        guide === null
          ? `The guide in \`${shellPath(dir)}/${APP_FILE_NAME}\` is missing: what ${name} is for, the endpoints a request needs, and what a request has to get right. ${write}`
          : `The guide in ${shellPath(dir)}/${APP_FILE_NAME} still has prompts \`${APP_COMMAND.name} new\` left, a few lines each from what you know about ${name}. ${write} Still there: ${unanswered.map((prompt) => `"${prompt}"`).join(" ")}`,
      slug,
      state: "failure",
    };
  }
  const kind =
    manifest.type === "web"
      ? "web"
      : manifest.type === "mcp-local"
        ? "run"
        : manifest.auth.kind === "oauth"
          ? "sign-in"
          : manifest.auth.kind === "none"
            ? "none"
            : "key";
  if (kind === "sign-in" && !config.apps.oauth) {
    return {
      message: "Sign-in is not available in this context.",
      slug,
      state: "failure",
    };
  }
  if (kind !== "none") {
    // What the user does on the card or the app's page comes back as an
    // app event with no chat of its own; the asks kept with the app are
    // what tell it which chats to wake.
    const waiting = connection?.waitingChats ?? [];
    await recordConnection(slug, {
      status:
        kind === "key"
          ? "needs-key"
          : kind === "run"
            ? "needs-approval"
            : "needs-sign-in",
      waitingChats: waiting.includes(chatId) ? waiting : [...waiting, chatId],
    });
  }
  return {
    kind,
    name,
    // One of the Mac's own apps installs nothing, so its card says nothing
    // of what runs.
    ...(manifest.type === "mcp-local" && manifest.runtime !== "bundled"
      ? { runs: describeLocalLaunch(manifest) }
      : {}),
    site: appSiteFor(slug, manifest),
    slug,
    state: "asked",
    ...(manifest.type === "web" ? { url: manifest.url } : {}),
  };
}

/** What the model reads of a call that named one app, the card being that app's alone. */
function oneAppModelOutput(output: ConnectAppResult): ToolResultPart["output"] {
  if (output.state === "failure") {
    return { type: "error-text", value: output.message };
  }
  if (output.state === "connected") {
    return {
      type: "text",
      value: `${output.name} is already connected; no card was shown. Use it.`,
    };
  }
  switch (output.kind) {
    case "key": {
      return {
        type: "text",
        value: `A card asking the user for a key for ${output.name} is in the conversation. Say one line and end your turn: you will be woken with a note when they save it or decline, and \`${APP_COMMAND.name} test ${output.slug}\` is the next step then. Do not poll, and do not test before the note.`,
      };
    }
    case "none": {
      return {
        type: "text",
        value: `${output.name} needs no sign-in. Run \`${APP_COMMAND.name} test ${output.slug}\` to connect it.`,
      };
    }
    case "run": {
      return {
        type: "text",
        value: `A card asking the user to let ${output.name}'s server run on this machine is in the conversation. Say one line and end your turn: you will be woken with a note when they allow it or decline, and the app installs and connects on its own when they do. Do not poll, and do not test before the note.`,
      };
    }
    case "sign-in": {
      return {
        type: "text",
        value: `A card asking the user to sign in to ${output.name} is in the conversation. Say one line and end your turn: you will be woken with a note when they have signed in or declined, and the app connects on its own when they do. Do not poll, and do not test before the note.`,
      };
    }
    case "web": {
      return {
        type: "text",
        value: `A card asking the user to sign in to ${output.name} on the web is in the conversation: it opens the sign-in in the window's browser. Say one line and end your turn: you will be woken with a note when they say they are signed in or decline, and the app is connected then. Do not poll, and do not test before the note.`,
      };
    }
  }
}

/**
 * What the model reads of a call that named several apps: the one card and
 * its rows, the single wake it waits for, and a line for each app that got
 * no row.
 */
function cardModelOutput(
  results: ConnectAppResult[],
): ToolResultPart["output"] {
  const rows = askedOnCard({ apps: results });
  const lines: string[] = [];
  if (rows.length > 0) {
    lines.push(
      `One card asking the user to connect ${rows.map((row) => `${row.name} (${row.slug})`).join(", ")} is in the conversation, a row for each. Say one line and end your turn. You are woken once, when every row is answered, with a note saying which apps they connected, as which account where it is known, and which they skipped. Do not poll, and do not test before the note.`,
    );
  }
  for (const result of results) {
    if (result.state === "connected") {
      lines.push(
        `- ${result.name} is already connected, so it has no row. Use it.`,
      );
    } else if (result.state === "asked" && result.kind === "none") {
      lines.push(
        `- ${result.name} needs no sign-in, so it has no row. Run \`${APP_COMMAND.name} test ${result.slug}\` to connect it.`,
      );
    } else if (result.state === "failure") {
      lines.push(
        `- ${result.slug} is not on the card and is not connected: ${result.message}`,
      );
    }
  }
  const failedAll = results.every((result) => result.state === "failure");
  if (!failedAll && results.some((result) => result.state === "failure")) {
    lines.push(
      "The user cannot connect an app that is not on the card. Fix each one now and ask for it with connect_app on its own, or tell the user, in your line, that it is not connected and why.",
    );
  }
  return failedAll
    ? { type: "error-text", value: lines.join("\n") }
    : { type: "text", value: lines.join("\n") };
}
