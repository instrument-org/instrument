import { TOOL_NAMES } from "./name";
import { type ToolResultPart } from "ai";
import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import {
  isConnected,
  readConnection,
  recordConnection,
} from "../lib/apps/connection";
import { lookupAppKeys } from "../lib/apps/credential-origin";
import { type LocalMcpAppManifest } from "../lib/apps/manifest";
import { describeLocalLaunch } from "../lib/apps/mcp/local-server";
import { onSameSite } from "../lib/apps/same-site";
import { appSiteFor } from "../lib/apps/site";
import {
  guidePlaceholdersLeft,
  loadApp,
  readAppGuide,
} from "../lib/apps/store";
import { APP_COMMAND } from "../model-text/commands/app-command";
import { ChatReads } from "../lib/chat-reads";
import { getWorkspaceConfig } from "../lib/workspace-config";
import {
  type ConnectAppResult,
  askedOnCard,
  ConnectAppOutputSchema,
  connectAppResults,
} from "./connect-app-output";
import { defineCapability } from "../lib/capabilities/define";
import { recordSignIn } from "../lib/chat/asks";
import { modelTool } from "../lib/capabilities/tool";
import { SITE_SIGN_IN_WORDS } from "../lib/screen-words";

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
        description: `The apps to connect: the \`id\` each was set up under with \`${APP_COMMAND.name} new\`. Every app the work needs goes in one call, one card for them all.`,
      }),
    signedIn: z
      .array(z.string())
      .max(MAX_APPS_PER_CARD)
      .optional()
      .meta({
        description:
          "Web apps among `slugs` whose site you opened in a tab of this chat and saw signed in: each is recorded as signed in on this computer, with no row on the card.",
      }),
  }),
  name: "apps.connect",
  summary: "Asks the person to connect apps on one card; the turn ends on it.",
  surfaces: {
    tool: {
      description: dedent`
    Ask the user to connect apps you have set up with \`${APP_COMMAND.name} new\`. One card appears in the conversation with a row for each app: sign-in buttons for an OAuth app, a secure field for a key, for an app whose server runs on this machine, what would run and a button to allow it, and for a web app, a ${SITE_SIGN_IN_WORDS.signIn} button that opens its sign-in in the window's browser, where the user presses ${SITE_SIGN_IN_WORDS.done} once signed in. A web app is asked for only once its site has been opened in a tab of this chat: one that loaded signed in goes in \`signedIn\`, and gets no row. Name every app the work needs in one call: several calls make several cards. Your turn ends on a call that puts up a card, so do what does not depend on the connection first. You are woken once, with a note, when the user has answered every row: signed in, saved a key, or declined. Never ask for a key in prose instead.
  `,
      execute: async ({ input, messageId, partId, sessionId, chatId }) => {
        const signedIn = new Set(input.signedIn);
        const slugs = [...new Set([...input.slugs, ...signedIn])];
        const visited = (await ChatReads.chatSites({ chatId })).unwrapOr([]);
        const apps: ConnectAppResult[] = [];
        // One at a time: each ask writes the app's connection record.
        for (const slug of slugs) {
          apps.push(
            await askFor(slug, { seenSignedIn: signedIn.has(slug), visited }),
          );
        }
        const failed = apps.flatMap((result) =>
          result.state === "failure"
            ? [{ reason: result.message, slug: result.slug }]
            : [],
        );
        await recordSignIn(
          { chatId, messageId, partId, sessionId },
          askedOnCard({ apps }).map(({ name, slug }) => ({ name, slug })),
          failed.length === 0 ? undefined : failed,
        );
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
  {
    seenSignedIn,
    visited,
  }: {
    /** Whether the agent saw the app's site load signed in. */
    seenSignedIn: boolean;
    /** The hosts the chat's browser has been on, its tasks' included. */
    visited: string[];
  },
): Promise<ConnectAppResult> {
  const config = getWorkspaceConfig();
  const loaded = await loadApp(requested);
  if (loaded.isErr()) {
    return {
      message: `${loaded.error.message} Set the app up first (\`${APP_COMMAND.name} new\`), then ask.`,
      slug: requested,
      state: "failure",
    };
  }
  const { manifest, manifestHash, name, slug } = loaded.value;
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
  const guide = await readAppGuide(slug);
  const unanswered =
    guide === null ? [] : guidePlaceholdersLeft(manifest, guide);
  if (manifest.type === "api" && (guide === null || unanswered.length > 0)) {
    const write = `Write it yourself with \`${APP_COMMAND.name} guide ${slug} <<'EOF'\` (the whole guide on stdin), then ask again.`;
    return {
      message:
        guide === null
          ? `The guide is missing: what ${name} is for, the endpoints a request needs, and what a request has to get right. ${write}`
          : `The guide still has prompts \`${APP_COMMAND.name} new\` left, a few lines each from what you know about ${name}. ${write} Still there: ${unanswered.map((prompt) => `"${prompt}"`).join(" ")}`,
      slug,
      state: "failure",
    };
  }
  if (manifest.type === "web") {
    // Nothing sees a session in the browser, so the site is looked at
    // before the user is asked: a card for a site already signed in is a
    // sign-in they have already done.
    const sites = [manifest.url, ...(manifest.signIn ? [manifest.signIn] : [])];
    if (!visited.some((host) => sites.some((url) => onSameSite(host, url)))) {
      return {
        message: `Open ${manifest.url} in a tab first and look. If it loads signed in, call ${TOOL_NAMES.connectApp} with "${slug}" in \`signedIn\`, which records that and shows no card; if it loads signed out, ask again.`,
        slug,
        state: "failure",
      };
    }
    if (seenSignedIn) {
      await recordConnection(slug, {
        connectedAt: Date.now(),
        manifestHash,
        seenSignedIn: true,
        status: "connected",
      });
      return { name, seen: true, slug, state: "connected" };
    }
  }
  const kind =
    manifest.type === "web"
      ? "web"
      : manifest.type === "mcp-local"
        ? await localServerNeeds(slug, manifest, {
            approved: connection?.approvedManifestHash === manifestHash,
          })
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
    // app event, which settles the call's sign-in ask (`lib/apps/events.ts`).
    await recordConnection(slug, {
      status:
        kind === "key"
          ? "needs-key"
          : kind === "run"
            ? "needs-approval"
            : "needs-sign-in",
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

/** A local server asks to be allowed first, then for the key it reads, where it reads one it does not have. */
async function localServerNeeds(
  slug: string,
  manifest: LocalMcpAppManifest,
  { approved }: { approved: boolean },
): Promise<"key" | "run"> {
  if (!approved || manifest.auth.kind === "none") {
    return "run";
  }
  const stored = await lookupAppKeys(slug, manifest);
  return stored.kind === "ok" ? "run" : "key";
}

/** What the model reads of a call that named one app, the card being that app's alone. */
function oneAppModelOutput(output: ConnectAppResult): ToolResultPart["output"] {
  if (output.state === "failure") {
    return { type: "error-text", value: output.message };
  }
  if (output.state === "connected") {
    return {
      type: "text",
      value: output.seen
        ? `${output.name} is recorded as signed in on this computer; no card was shown. Carry on in its tab.`
        : `${output.name} is already connected; no card was shown. Use it.`,
    };
  }
  switch (output.kind) {
    case "key": {
      return {
        type: "text",
        value: `A card asking the user for a key for ${output.name} is in the conversation. Your turn ended on it: you will be woken with a note when they save it or decline, and \`${APP_COMMAND.name} test ${output.slug}\` is the next step then. Do not poll, and do not test before the note.`,
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
        value: `A card asking the user to let ${output.name}'s server run on this machine is in the conversation. Your turn ended on it: you will be woken with a note when they allow it or decline, and the app installs and connects on its own when they do. Do not poll, and do not test before the note.`,
      };
    }
    case "sign-in": {
      return {
        type: "text",
        value: `A card asking the user to sign in to ${output.name} is in the conversation. Your turn ended on it: you will be woken with a note when they have signed in or declined, and the app connects on its own when they do. Do not poll, and do not test before the note.`,
      };
    }
    case "web": {
      return {
        type: "text",
        value: `A card asking the user to sign in to ${output.name} on the web is in the conversation: it opens the sign-in in the window's browser. Your turn ended on it: you will be woken with a note when they say they are signed in or decline, and the app is connected then. Do not poll, and do not test before the note.`,
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
      `One card asking the user to connect ${rows.map((row) => `${row.name} (${row.slug})`).join(", ")} is in the conversation, a row for each. Your turn ended on it. You are woken once, when every row is answered, with a note saying which apps they connected, as which account where it is known, and which they skipped. Do not poll, and do not test before the note.`,
    );
  }
  for (const result of results) {
    if (result.state === "connected") {
      lines.push(
        result.seen
          ? `- ${result.name} is recorded as signed in on this computer, so it has no row. Carry on in its tab.`
          : `- ${result.name} is already connected, so it has no row. Use it.`,
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
      `The user cannot connect an app that is not on the card. Fix each one now and ask for it with ${TOOL_NAMES.connectApp} on its own, or tell the user, in your line, that it is not connected and why.`,
    );
  }
  return failedAll
    ? { type: "error-text", value: lines.join("\n") }
    : { type: "text", value: lines.join("\n") };
}
