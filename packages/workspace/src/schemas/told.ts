import { z } from "zod";

/**
 * What a session's model was brought up to about things that change under a
 * chat: carried by the note that told it, or by the baseline for the picture
 * the session began with, so "what it was last told" is read from its own
 * history (`lib/last-told.ts`).
 */

/** The workspace's apps as a chat's agent was told of them, by id. */
export const ToldAppsSchema = z.record(
  z.string(),
  z.object({
    connected: z.boolean(),
    /** What its folder held (`folder-fingerprint.ts`). */
    fingerprint: z.string(),
    name: z.string(),
    web: z.string().optional(),
  }),
);

export type ToldApps = z.output<typeof ToldAppsSchema>;

/** The folders granted in the chat the session was told it reaches, by path. */
export const ToldFoldersSchema = z.array(z.object({ path: z.string() }));

export type ToldFolders = z.output<typeof ToldFoldersSchema>;

/**
 * A fingerprint per item: a memory by its name (`memoryDigests`), a skill by
 * `skill:<name>` (`setup-news.ts`).
 */
export const ToldDigestsSchema = z.record(z.string(), z.string());

export type ToldDigests = z.output<typeof ToldDigestsSchema>;
