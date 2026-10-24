import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";

/**
 * Bringing a person's chats in from another AI app: the shapes every source
 * reads into and the importer writes from.
 *
 * Reading is deterministic. A source is a parser over files the person
 * already has: a coding agent's session logs in their home folder, or the
 * export zip a chat service emailed them. Nothing here signs in anywhere or
 * reads a service's private endpoints. The agent can drive an import (list,
 * pick, bring in), but what lands in a chat is what the files said.
 *
 * A source first lists what it has (`ImportCandidate`, cheap enough for a
 * picker over thousands), then reads the ones picked in full
 * (`ImportedTranscript`). An imported chat names where it came from in its
 * session header, so listing again marks what is already here and importing
 * again skips it.
 */

const ImportSourceKindSchema = z.enum([
  "claude-code",
  "codex",
  "cursor",
  "chatgpt-export",
  "claude-export",
]);

type ImportSourceKind = z.output<typeof ImportSourceKindSchema>;

/**
 * Where an import reads from: a coding agent on this computer, found in the
 * home folder, or an export file the person picked.
 */
const ImportFromSchema = z.discriminatedUnion("type", [
  z.object({
    kind: ImportSourceKindSchema.extract(["claude-code", "codex", "cursor"]),
    type: z.literal("local"),
  }),
  z.object({
    /** The export's real path: a `.zip`, or the folder it was unpacked to. */
    path: z.string(),
    type: z.literal("export"),
  }),
]);

export type ImportFrom = z.output<typeof ImportFromSchema>;

/** A source there is something to import from, as a picker offers it. */
const ImportSourceSchema = z.object({
  from: ImportFromSchema,
  kind: ImportSourceKindSchema,
  /** The product's name, as its own users say it: "ChatGPT", "Claude Code". */
  name: z.string(),
  /** Where it reads from, as a person would write it: `~/.claude`. */
  location: z.string(),
  /** The site the product's mark comes from. */
  site: z.string(),
});

export type ImportSource = z.output<typeof ImportSourceSchema>;

/** One chat a source has, listed without reading it in full. */
const ImportCandidateSchema = z.object({
  kind: ImportSourceKindSchema,
  /** The chat's id in the source, stable across exports and listings. */
  sourceId: z.string().min(1),
  /** The source's own title, or the opening ask's first words when it has none. */
  title: z.string(),
  createdAt: z.date(),
  /** When the last message in it was written. */
  updatedAt: z.date(),
  /** Messages the person and the AI wrote, tool activity aside. */
  messages: z.number().int().nonnegative(),
  /** The first words the person wrote, for telling look-alike titles apart. */
  preview: z.string().optional(),
  /**
   * What the chat was filed under in the source: a coding agent's working
   * folder, as a person writes it (`~/code/site`), or a ChatGPT or Claude
   * project's name.
   */
  project: z.string().optional(),
  /**
   * A chat the source made on its own rather than one the person had: a
   * coding agent's subagent run, a session that never got a reply. Listed
   * so a count is honest; a picker leaves them out by default.
   */
  incidental: z.boolean().optional(),
});

export type ImportCandidate = z.output<typeof ImportCandidateSchema>;

/**
 * What a message had that does not come across as text, said in the
 * imported message so the chat is honest about what it lost.
 */
const ImportOmittedSchema = z.object({
  /** Images and files the message had, by count. */
  attachments: z.number().int().positive().optional(),
  /** Tool calls the reply made, by the tool's name in the source. */
  toolCalls: z.record(z.string(), z.number().int().positive()).optional(),
});

export type ImportOmitted = z.output<typeof ImportOmittedSchema>;

const ImportedMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  /** Markdown, as the source had it. */
  text: z.string(),
  createdAt: z.date(),
  /** The source's name for the model that wrote a reply. */
  model: z.string().optional(),
  omitted: ImportOmittedSchema.optional(),
});

export type ImportedMessage = z.output<typeof ImportedMessageSchema>;

/**
 * One chat read in full: the person's and the AI's words in order, one
 * branch of it where the source kept edits and regenerations as branches
 * (the one the person last saw).
 */
const ImportedTranscriptSchema = ImportCandidateSchema.extend({
  messages: z.array(ImportedMessageSchema),
});

export type ImportedTranscript = z.output<typeof ImportedTranscriptSchema>;

/**
 * Where an imported chat came from, in its session header: what listing
 * again matches to say a chat is already here.
 */
export const ImportedFromSchema = z.object({
  kind: ImportSourceKindSchema,
  sourceId: z.string().min(1),
});

export type ImportedFrom = z.output<typeof ImportedFromSchema>;

/** The key two imports of one source chat share. */
export function importKey(from: ImportedFrom): string {
  return `${from.kind}:${from.sourceId}`;
}

/**
 * A parser over one source. `list` is what a picker shows; `read` reads the
 * picked ones in full, in any order, skipping an id it no longer has.
 */
export interface ChatSource {
  kind: ImportSourceKind;
  list(): Promise<ImportCandidate[]>;
  read(sourceIds: readonly string[]): AsyncIterable<ImportedTranscript>;
}

// ---
// RPC
// ---
// `chatImport.*` in the workspace router. Studio's picker and the agent's
// `instrument import` command both go through these.

/** `chatImport.sources`: what this computer has to import from, no input. */
export const ListSourcesOutputSchema = ImportSourceSchema.array();

/** `chatImport.list`: every chat a source has, newest first. */
export const ListCandidatesInputSchema = z.object({ from: ImportFromSchema });

const ListedCandidateSchema = ImportCandidateSchema.extend({
  /** The chat it was already imported as, or null. */
  imported: ChatIdSchema.nullable(),
});

export type ListedCandidate = z.output<typeof ListedCandidateSchema>;

export const ListCandidatesOutputSchema = z.object({
  source: ImportSourceSchema,
  candidates: ListedCandidateSchema.array(),
});

/**
 * `chatImport.run`: brings the picked chats in. Answers once every one has
 * landed or failed; `chatImport.events.progress` says how far it is.
 */
export const RunImportInputSchema = z.object({
  from: ImportFromSchema,
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const RunImportOutputSchema = z.object({
  imported: z.array(z.object({ chatId: ChatIdSchema, sourceId: z.string() })),
  /** Already here, so left alone. */
  skipped: z.array(z.object({ chatId: ChatIdSchema, sourceId: z.string() })),
  failed: z.array(z.object({ error: z.string(), sourceId: z.string() })),
});

export type RunImportOutput = z.output<typeof RunImportOutputSchema>;

/** `chatImport.events.progress`: one per chat a run finishes. */
export const ImportProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /** The title of the chat that just finished. */
  title: z.string(),
});

export type ImportProgress = z.output<typeof ImportProgressSchema>;
