import { REASONING_EFFORTS } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { StoreId } from "./store-id";

// Load-bearing that this stays a plain object schema: it is parsed against the
// whole task record, whose `state` key it is meant to ignore rather than reject.
// Making it strict would fail every task's settings at once and take every title
// in the workspace with them.
export const TaskSettingsSchema = z.object({
  // The apps this task may reach through the `app` command, by slug: set on
  // a briefed task, possibly to none. Absent on a chat, which reaches every
  // app.
  apps: z.array(z.string()).optional(),
  // On a chat's record, the one session it holds. A chat's folder is named for
  // what it is about, so this is how a session finds its chat. Whether a
  // record is a chat, and which chat a task belongs to, is where its folder
  // is (record-folders.ts), never a field here.
  chatSessionId: StoreId.SessionSchema.optional(),
  // When the task was made, recorded for the same reason as `lastActivityAt`:
  // the observable answer is the session database's birth time, which is when
  // the task was first opened, and for a branched or imported task it is when
  // the copy happened.
  createdAt: z.coerce.date().optional(),
  createdWithAppVersion: z.string().optional(),
  // When something happened in this task, as opposed to when a file under it
  // was last written. It orders the task list, and it is recorded rather than
  // observed because the observable timestamps do not mean what the list needs:
  // the session database is rewritten by the act of opening a task, so sorting
  // on its mtime moves a task to the top for having been read.
  lastActivityAt: z.coerce.date().optional(),
  name: z.string().default("Untitled task"),
  // How hard this task's model is asked to think, on every turn it takes,
  // the turns of the chat's tasks included. Absent leaves the provider's own
  // default, which is what every task took before this existed.
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
});

export const TaskSettingsUpdateSchema = TaskSettingsSchema.partial().extend({
  lastActivityAt: z.coerce.date().optional(),
  name: z.string().trim().min(1).optional(),
});

export type TaskSettings = z.output<typeof TaskSettingsSchema>;
export type TaskSettingsUpdate = z.output<typeof TaskSettingsUpdateSchema>;
