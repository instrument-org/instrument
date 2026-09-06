import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { recordConnection } from "../lib/apps/connection";
import { appSite } from "../lib/apps/manifest";
import { loadApp } from "../lib/apps/store";
import { APP_COMMAND } from "../lib/shell-commands/app-command";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { MOUNT } from "../mount-points";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Ask the user for the one thing only they can give an app: a sign-in, or a
 * key. Not an interactive call: it puts a card in the conversation and
 * returns at once, so the turn ends and the user can keep talking. What they
 * do on the card reaches the agent later as an app event, the way a finishing
 * task does, and the credential itself never passes through the model.
 */
export const ConnectApp = setupTool({
  inputSchema: BaseInputSchema.extend({
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence, addressed to the user, saying what connecting it lets you do for them: 'So I can read and write your Notion pages.'",
    }),
    slug: z.string().meta({
      description: `The app to connect: its folder name under ${MOUNT.apps}/, already written.`,
    }),
  }),
  name: "connect_app",
  outputSchema: z.discriminatedUnion("state", [
    z.object({
      /** What the card asks for: a browser sign-in, a key, or nothing. */
      kind: z.enum(["key", "none", "sign-in"]),
      name: z.string(),
      /** The service's origin, for the card's icon. */
      site: z.string().optional(),
      slug: z.string(),
      state: z.literal("asked"),
    }),
    z.object({
      message: z.string(),
      slug: z.string(),
      state: z.literal("failure"),
    }),
  ]),
}).create({
  description: dedent`
    Ask the user to connect an app whose folder you have written under ${MOUNT.apps}/<slug>/. A card appears in the conversation: a sign-in button for an OAuth app, a secure field for a key. It returns at once; say one line and end your turn. You are woken with a note when the user has signed in, saved a key, or declined. Never ask for a key in prose instead.
  `,
  execute: async ({ input }) => {
    const config = getWorkspaceConfig();
    const loaded = await loadApp(config.appsDir, input.slug);
    if (loaded.isErr()) {
      return ok({
        message: `${loaded.error.message} Write the app's folder first (\`${APP_COMMAND.name} new\`), then ask.`,
        slug: input.slug,
        state: "failure" as const,
      });
    }
    const { manifest, slug } = loaded.value;
    const kind =
      manifest.auth.kind === "oauth"
        ? "sign-in"
        : manifest.auth.kind === "none"
          ? "none"
          : "key";
    if (kind === "sign-in" && !config.apps.oauth) {
      return ok({
        message: "Sign-in is not available in this context.",
        slug,
        state: "failure" as const,
      });
    }
    if (kind !== "none") {
      await recordConnection(slug, {
        status: kind === "key" ? "needs-key" : "needs-sign-in",
      });
    }
    return ok({
      kind,
      name: manifest.name,
      site: appSite(manifest),
      slug,
      state: "asked" as const,
    });
  },
  readOnly: false,
  timeoutMs: ms("10 seconds"),
  toModelOutput: ({ output }) => {
    if (output.state === "failure") {
      return { type: "error-text", value: output.message };
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
      case "sign-in": {
        return {
          type: "text",
          value: `A card asking the user to sign in to ${output.name} is in the conversation. Say one line and end your turn: you will be woken with a note when they have signed in or declined, and the app connects on its own when they do. Do not poll, and do not test before the note.`,
        };
      }
    }
  },
});
