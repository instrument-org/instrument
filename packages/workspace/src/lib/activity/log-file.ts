import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { DEVICE_ID_PATTERN } from "../records/device-id";
import { workspaceLayout } from "../workspace-layout";
import {
  ActivityKindSchema,
  ActivityPurposeSchema,
  type ActivityRow,
  ActivityStatusSchema,
  ActivitySurfaceSchema,
} from "./schema";

/**
 * The activity log on disk: each device's model requests, one JSON line per
 * request, in `.instrument/devices/<device>/activity/<YYYY-MM>.jsonl` in the
 * workspace, so it travels with the workspace as the chats do. Only that
 * device appends to its files, so a sync engine never has two versions of
 * one to choose between; every device reads all of them. A month to a file
 * keeps each one small and its name the month it covers, in UTC.
 *
 * A line leaves out what the request did not have, and never carries the
 * connection's id, which names a provider set up on one computer only.
 */

const ACTIVITY_FOLDER = "activity";
const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/;
const DEVICE_FOLDER = new RegExp(`^${DEVICE_ID_PATTERN}$`);

const nullish = <T extends z.ZodType>(schema: T) => schema.nullish();

/** One line as written, read back tolerant of what a newer build adds. */
const LineSchema = z.object({
  at: z.iso.datetime(),
  chat: nullish(z.string()),
  connection: nullish(
    z.object({ name: nullish(z.string()), type: nullish(z.string()) }),
  ),
  error: nullish(z.string()),
  finish: nullish(z.string()),
  id: z.string().min(1),
  imageQuality: nullish(z.string()),
  kind: ActivityKindSchema,
  model: nullish(
    z.object({ requested: nullish(z.string()), served: nullish(z.string()) }),
  ),
  ms: nullish(z.number()),
  purpose: ActivityPurposeSchema,
  responseId: nullish(z.string()),
  session: nullish(z.string()),
  status: ActivityStatusSchema,
  surface: nullish(ActivitySurfaceSchema),
  tokens: nullish(
    z.object({
      cacheRead: nullish(z.number()),
      cacheWrite: nullish(z.number()),
      input: nullish(z.number()),
      output: nullish(z.number()),
      reasoning: nullish(z.number()),
      total: nullish(z.number()),
    }),
  ),
});

/** Where a device's activity files are. */
function activityDirOf(rootDir: string, device: string): string {
  return path.join(
    workspaceLayout(rootDir).devicesDir,
    device,
    ACTIVITY_FOLDER,
  );
}

/** The file a request made at `startedAt` goes in. */
export function activityFileOf(
  rootDir: string,
  device: string,
  startedAt: number,
): string {
  const month = new Date(startedAt).toISOString().slice(0, 7);
  return path.join(activityDirOf(rootDir, device), `${month}.jsonl`);
}

/** Every device's activity files in the workspace, each with its device. */
export function activityFiles(
  rootDir: string,
): { device: string; file: string }[] {
  const devicesDir = workspaceLayout(rootDir).devicesDir;
  const found: { device: string; file: string }[] = [];
  for (const device of namesIn(devicesDir)) {
    if (!DEVICE_FOLDER.test(device)) {
      continue;
    }
    const dir = activityDirOf(rootDir, device);
    for (const name of namesIn(dir)) {
      if (MONTH_FILE.test(name)) {
        found.push({ device, file: path.join(dir, name) });
      }
    }
  }
  return found;
}

/** A row as one line of its device's file, newline included. */
export function lineOf(row: ActivityRow): string {
  const line = {
    id: row.id,
    at: new Date(row.startedAt).toISOString(),
    ms: row.durationMs,
    status: row.status,
    error: row.error,
    finish: row.finishReason,
    kind: row.kind,
    purpose: row.purpose,
    chat: row.chatId,
    session: row.sessionId,
    surface: row.surface,
    connection: present({ name: row.connectionName, type: row.connectionType }),
    model: present({ requested: row.modelRequested, served: row.modelServed }),
    imageQuality: row.imageQuality,
    responseId: row.responseId,
    tokens: present({
      cacheRead: row.cacheReadTokens,
      cacheWrite: row.cacheWriteTokens,
      input: row.inputTokens,
      output: row.outputTokens,
      reasoning: row.reasoningTokens,
      total: row.totalTokens,
    }),
  };
  return `${JSON.stringify(withoutNulls(line))}\n`;
}

/** A line read back as the row it was, or nothing for one that will not parse. */
export function rowOf(line: string, device: string): ActivityRow | undefined {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = LineSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  const read = parsed.data;
  return {
    cacheReadTokens: read.tokens?.cacheRead ?? null,
    cacheWriteTokens: read.tokens?.cacheWrite ?? null,
    chatId: read.chat ?? null,
    connectionName: read.connection?.name ?? null,
    connectionType: read.connection?.type ?? null,
    device,
    durationMs: read.ms ?? null,
    error: read.error ?? null,
    finishReason: read.finish ?? null,
    id: read.id,
    imageQuality: read.imageQuality ?? null,
    inputTokens: read.tokens?.input ?? null,
    kind: read.kind,
    modelRequested: read.model?.requested ?? null,
    modelServed: read.model?.served ?? null,
    outputTokens: read.tokens?.output ?? null,
    purpose: read.purpose,
    reasoningTokens: read.tokens?.reasoning ?? null,
    responseId: read.responseId ?? null,
    sessionId: read.session ?? null,
    startedAt: Date.parse(read.at),
    status: read.status,
    surface: read.surface ?? null,
    totalTokens: read.tokens?.total ?? null,
  };
}

/**
 * The whole lines of `file` from byte `from`, and where they end. A last line
 * with no newline yet (a sync engine part way through bringing the file
 * over, or a write cut short) is left for the next read.
 */
export function readLinesFrom(
  file: string,
  from: number,
): { end: number; lines: string[] } {
  const handle = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(handle);
    const bytes = Buffer.alloc(Math.max(0, size - from));
    fs.readSync(handle, bytes, 0, bytes.length, from);
    const whole = bytes.lastIndexOf(0x0a) + 1;
    return {
      end: from + whole,
      lines: bytes
        .subarray(0, whole)
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim() !== ""),
    };
  } finally {
    fs.closeSync(handle);
  }
}

function namesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** An object of its non-null fields, or nothing when it has none. */
function present<T extends Record<string, unknown>>(fields: T) {
  return Object.values(fields).some((value) => value !== null)
    ? withoutNulls(fields)
    : null;
}

function withoutNulls<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null),
  );
}
