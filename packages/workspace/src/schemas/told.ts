import { z } from "zod";

import { DeviceIdSchema } from "./device-id";

/**
 * What a session's model was brought up to about things that change under a
 * chat: carried by the note that told it, or by the baseline for the picture
 * the session began with, so "what it was last told" is read from its own
 * history (`lib/last-told.ts`).
 */

/**
 * The workspace's apps as a chat's agent was told of them, by id. An app's
 * folder is the workspace's, the same on every computer, but its connection
 * is one computer's (its key or sign-in and its connection record stay
 * there), so `connected` names the computer it was read on.
 */
export const ToldAppsSchema = z.record(
  z.string(),
  z.object({
    connected: z.boolean(),
    /**
     * The device `connected` was read on. Another device's, or none (an entry
     * written before this was recorded), says nothing about this computer's
     * connections, which are then told whole rather than as changes.
     */
    device: DeviceIdSchema.optional(),
    /** What its folder held (`folder-fingerprint.ts`). */
    fingerprint: z.string(),
    name: z.string(),
    web: z.string().optional(),
  }),
);

export type ToldApps = z.output<typeof ToldAppsSchema>;

/**
 * The folders granted in the chat the session was told it reaches, by path.
 * A grant is one computer's (`permissions.json`), so `device` names the
 * computer whose grant was told: only that computer can take it back. None
 * on an entry written before this was recorded, which no computer claims.
 */
export const ToldFoldersSchema = z.array(
  z.object({ device: DeviceIdSchema.optional(), path: z.string() }),
);

export type ToldFolders = z.output<typeof ToldFoldersSchema>;

/**
 * A fingerprint per item: a memory by its name (`memoryDigests`), a skill by
 * `skill:<name>` (`setup-news.ts`).
 */
export const ToldDigestsSchema = z.record(z.string(), z.string());

export type ToldDigests = z.output<typeof ToldDigestsSchema>;
