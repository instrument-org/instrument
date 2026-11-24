import { type Draft, type DraftOpBatch } from "@/shared/drafts";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { logger } from "../lib/electron-logger";

/** The file of {@link createNewTabDrafts}, in the workspace's window folder on this computer. */
const FILE_NAME = "new-tab-drafts.json";

/** How long a draft no tab can come back to is left before a launch throws it away. */
export const LOST_DRAFT_KEPT_MS = 24 * 60 * 60 * 1000;

const RecordsSchema = z.record(
  z.string(),
  z.object({
    /** When a launch first found no tab, open or closed, that names it. */
    lostAt: z.number().optional(),
    /** The draft's `updatedAt` as this computer last wrote it, so a change made elsewhere shows. */
    updatedAt: z.number(),
  }),
);
type Records = z.output<typeof RecordsSchema>;

/**
 * The drafts started in a new tab on this computer and touched nowhere else
 * since: the only ones a launch may throw away once no tab can come back to
 * them. Kept beside the tabs, on this computer, so a draft from a phone or
 * another computer is never among them.
 *
 * Nothing here is worth losing a draft for, so whatever cannot be read (this
 * file, or any file of the tabs) keeps every draft.
 */
export function createNewTabDrafts({
  now = Date.now,
  windowDir,
}: {
  now?: () => number;
  /** Where this computer keeps the windows' tabs, read as they were left. */
  windowDir: string;
}) {
  const file = path.join(windowDir, FILE_NAME);
  let records = readRecords(file);

  const write = (next: Records) => {
    records = next;
    const temporary = `${file}.${process.pid.toString()}.tmp`;
    try {
      fs.mkdirSync(windowDir, { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`);
      fs.renameSync(temporary, file);
    } catch (error) {
      logger.warn("Could not keep which drafts were started here", error);
    }
  };

  return {
    /** Follows a window's ops, given the drafts they left. */
    applied(batch: DraftOpBatch, drafts: Draft[]) {
      const next = { ...records };
      let isChanged = false;
      for (const op of batch.ops) {
        const id = op.type === "create" ? op.draft.id : op.id;
        const draft = drafts.find((entry) => entry.id === id);
        const known = next[id];
        const isStart = op.type === "create" && op.draft.chatId === undefined;
        if (op.type === "keep" || draft === undefined) {
          if (known !== undefined) {
            delete next[id];
            isChanged = true;
          }
        } else if (
          (isStart || known !== undefined) &&
          known?.updatedAt !== draft.updatedAt
        ) {
          next[id] = { updatedAt: draft.updatedAt };
          isChanged = true;
        }
      }
      if (isChanged) {
        write(next);
      }
    },

    /** Leaves for good the drafts any of this names, whatever tabs do after. */
    keepNamedIn(value: unknown) {
      const text = JSON.stringify(value) ?? "";
      const next = Object.fromEntries(
        Object.entries(records).filter(([id]) => !text.includes(id)),
      );
      if (Object.keys(next).length < Object.keys(records).length) {
        write(next);
      }
    },

    /**
     * The drafts to throw away, asked once a launch: words alone, started
     * here and changed nowhere else, named by no tab, open or closed, in any
     * window, and found so by a launch at least {@link LOST_DRAFT_KEPT_MS}
     * ago. A tab names a draft wherever its id stands in the kept state,
     * the steps of a tab's history and a closed group's tabs included.
     */
    lost(drafts: Draft[]): string[] {
      if (Object.keys(records).length === 0) {
        return [];
      }
      const kept = readTabs(windowDir);
      if (kept === undefined) {
        return [];
      }
      const at = now();
      const next: Records = {};
      const lost: string[] = [];
      for (const [id, record] of Object.entries(records)) {
        const draft = drafts.find((entry) => entry.id === id);
        if (
          draft === undefined ||
          !isSameSecond(draft.updatedAt, record.updatedAt) ||
          // Tabs set aside as unreadable since it was written may have named it.
          kept.setAsideAt >= record.updatedAt
        ) {
          continue;
        }
        // One with more than words now may yet be down to words again.
        if (!isWordsAlone(draft) || kept.text.includes(id)) {
          next[id] = { updatedAt: record.updatedAt };
          continue;
        }
        const lostAt = record.lostAt ?? at;
        next[id] = { ...record, lostAt };
        if (at - lostAt >= LOST_DRAFT_KEPT_MS) {
          lost.push(id);
        }
      }
      write(next);
      return lost;
    },
  };
}

/** Whether words are all a draft has, a chat of its own not asked for by any device. */
function isWordsAlone(draft: Draft): boolean {
  return (
    draft.chatId === undefined &&
    draft.sendOn === undefined &&
    draft.sendingTo === undefined &&
    draft.projectId === undefined &&
    (draft.attached ?? []).length === 0 &&
    (draft.inFolder ?? []).length === 0 &&
    (draft.context ?? []).length === 0 &&
    (draft.asks ?? []).length === 0
  );
}

/** A draft's file keeps its times to the second. */
function isSameSecond(a: number, b: number): boolean {
  return Math.floor(a / 1000) === Math.floor(b / 1000);
}

function readRecords(file: string): Records {
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- read once as the drafts open, before any window's op can be followed.
    return RecordsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

/**
 * The text of every file the tabs are kept in, and when one was last set
 * aside as unreadable; nothing where the groups' file or every window's is
 * missing, or any cannot be read.
 */
function readTabs(
  windowDir: string,
): undefined | { setAsideAt: number; text: string } {
  try {
    const windowsDir = path.join(windowDir, "windows");
    const shared = fs.readdirSync(windowDir);
    const windows = fs.readdirSync(windowsDir);
    if (
      !shared.includes("groups.json") ||
      !windows.some((name) => name.endsWith(".json"))
    ) {
      return undefined;
    }
    let setAsideAt = 0;
    let text = "";
    for (const file of [
      ...shared.map((name) => path.join(windowDir, name)),
      ...windows.map((name) => path.join(windowsDir, name)),
    ]) {
      const name = path.basename(file);
      if (/\.corrupt-\d+$/.test(name)) {
        setAsideAt = Math.max(setAsideAt, Number(name.split("-").at(-1)));
      } else if (name.endsWith(".json") && name !== FILE_NAME) {
        // oxlint-disable-next-line studio/no-sync-content-read -- once a launch, so every file is read as of one moment.
        const content = fs.readFileSync(file, "utf8");
        JSON.parse(content);
        text += content;
      }
    }
    return { setAsideAt, text };
  } catch (error) {
    logger.warn("Could not read the tabs, so every draft is kept", error);
    return undefined;
  }
}
