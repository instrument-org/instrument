import { type TabId } from "@/shared/tabs";
import {
  MAX_PROMPT_STORAGE_LENGTH,
  type TaskId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { atom, type SetStateAction } from "jotai";
import { atomFamily, useHydrateAtoms } from "jotai/utils";
import { debounce } from "radashi";

import { rpcClient } from "../rpc/client";

// A prompt draft is scoped one of three ways:
//  - task: the follow-up input on an existing task, persisted with the task so
//    it survives closing and reopening the task.
//  - compose: the "new task" input on the new-tab / project pages, keyed by the
//    owning tab so each tab composes independently. Ephemeral by design; a
//    half-written new task isn't worth persisting across restarts.
//  - transient: a composer that starts from a prefill and is meant to be thrown
//    away, like the one on a skill page. Nothing is shared or retained, so
//    walking away from the surface loses the draft instead of carrying it to
//    the next skill and to the new-tab composer.
export type PromptDraftKey =
  | { id: string; scope: "transient" }
  | { scope: "compose"; tabId: TabId }
  | { scope: "task"; taskId: TaskId };

function draftKeyString(key: PromptDraftKey): string {
  switch (key.scope) {
    case "compose": {
      return `compose:${key.tabId}`;
    }
    case "task": {
      return `task:${key.taskId}`;
    }
    case "transient": {
      return `transient:${key.id}`;
    }
  }
}

// How long typing settles before the draft is written back.
const DRAFT_SAVE_DELAY_MS = 1000;

/**
 * The write-behind for one task's draft.
 *
 * It deliberately outlives the composer: leaving the route mid-sentence should
 * still land the last edit, so the timer belongs to the task rather than to a
 * mounted component. Nothing here ever reads, which is the point -- the stored
 * draft is loaded once with the rest of the task's state and seeded in, so a
 * keystroke has no load to race.
 */
function createDraftSaver(taskId: TaskId) {
  let pending: string | undefined;

  const write = debounce({ delay: DRAFT_SAVE_DELAY_MS }, (value: string) => {
    pending = undefined;
    void safe(
      rpcClient.workspace.task.state.set.call({
        id: taskId,
        state: { promptDraft: value },
      }),
    );
  });

  const flush = () => {
    if (pending !== undefined && write.isPending()) {
      write.flush(pending);
    }
  };

  return {
    dispose: () => {
      flush();
      write.cancel();
    },
    flush,
    schedule: (value: string) => {
      // The server drops an oversized draft anyway, so skip the round trip and
      // leave the last storable version in place.
      if (value.length > MAX_PROMPT_STORAGE_LENGTH) {
        return;
      }
      pending = value;
      write(value);
    },
  };
}

const draftSavers = new Map<TaskId, ReturnType<typeof createDraftSaver>>();

function draftSaver(taskId: TaskId) {
  const existing = draftSavers.get(taskId);
  if (existing) {
    return existing;
  }
  const saver = createDraftSaver(taskId);
  draftSavers.set(taskId, saver);
  return saver;
}

// A draft still inside the debounce window has no timer left once the window
// goes away, which is exactly the case when someone reloads right after typing.
window.addEventListener("pagehide", () => {
  for (const saver of draftSavers.values()) {
    saver.flush();
  }
});

// Ephemeral, in-memory compose drafts, one per tab.
const composeDraftFamily = atomFamily((_tabId: TabId) => atom(""));

// Transient drafts, discarded by the composer when it unmounts or re-keys.
const transientDraftFamily = atomFamily((_id: string) => atom(""));

// What the composer is editing, before any of it is written back.
const taskDraftValueFamily = atomFamily((_taskId: TaskId) => atom(""));

// Task follow-up drafts: read straight from memory, written back behind the
// edit. Seeded by `useHydrateTaskDraft` from the task state the route has
// already loaded, so there is no second fetch and nothing to arrive late.
const taskDraftFamily = atomFamily((taskId: TaskId) =>
  atom(
    (get) => get(taskDraftValueFamily(taskId)),
    (get, set, update: SetStateAction<string>) => {
      const valueAtom = taskDraftValueFamily(taskId);
      const next =
        typeof update === "function" ? update(get(valueAtom)) : update;
      set(valueAtom, next);
      draftSaver(taskId).schedule(next);
    },
  ),
);

/** The value atom for a draft, resolving to the right backing store per scope. */
export function promptDraftAtom(key: PromptDraftKey) {
  switch (key.scope) {
    case "compose": {
      return composeDraftFamily(key.tabId);
    }
    case "task": {
      return taskDraftFamily(key.taskId);
    }
    case "transient": {
      return transientDraftFamily(key.id);
    }
  }
}

/** Drop a task's draft from memory, once its last edit is on its way out. */
export function releaseTaskDraft(taskId: TaskId) {
  draftSavers.get(taskId)?.dispose();
  draftSavers.delete(taskId);
  taskDraftFamily.remove(taskId);
  taskDraftValueFamily.remove(taskId);
}

/**
 * Seed a task's composer from its stored draft, once.
 *
 * Hydration writes the value atom directly rather than going through the draft
 * atom, so restoring what was saved does not count as an edit and does not
 * schedule a write of the bytes it just read.
 */
export function useHydrateTaskDraft(taskId: TaskId, promptDraft: string) {
  useHydrateAtoms([[taskDraftValueFamily(taskId), promptDraft]]);
}

// The live textarea for a draft, so imperative focus targets the right input
// even with several prompt surfaces mounted across tabs.
const promptDraftRefFamily = atomFamily((_key: string) =>
  atom<HTMLElement | null>(null),
);

/** Focus a prompt textarea and drop the caret at the end of its text. */
export function focusPromptDraft(el: HTMLElement | null) {
  if (!el) {
    return;
  }
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function promptDraftRefAtom(key: PromptDraftKey) {
  return promptDraftRefFamily(draftKeyString(key));
}

/** Drop a transient draft so re-opening the surface starts from its prefill. */
export function removeTransientDraft(id: string) {
  transientDraftFamily.remove(id);
  promptDraftRefFamily.remove(draftKeyString({ id, scope: "transient" }));
}

// A per-tab focus signal, bumped whenever the active tab navigates in place (see
// `navigateTab`). A sidebar click whose destination equals the current route is
// a no-op navigation, so nothing remounts to re-run the prompt's focus effect;
// the page's prompt watches this signal to re-assert focus on that click too.
const promptFocusSignalFamily = atomFamily((_tabId: TabId) => atom(0));

export function promptFocusSignalAtom(tabId: TabId) {
  return promptFocusSignalFamily(tabId);
}

export const bumpPromptFocusAtom = atom(null, (get, set, tabId: TabId) => {
  const signal = promptFocusSignalFamily(tabId);
  set(signal, get(signal) + 1);
});

export const appendToPromptAtom = atom(
  null,
  (
    get,
    set,
    { key, update }: { key: PromptDraftKey; update: SetStateAction<string> },
  ) => {
    const valueAtom = promptDraftAtom(key);
    const prev = get(valueAtom);
    const next =
      typeof update === "function"
        ? update(prev)
        : (prev.trimEnd() ? prev.trimEnd() + " " : "") + update.trim() + " ";
    set(valueAtom, next);
    const el = get(promptDraftRefAtom(key));
    el?.focus();
    // The value lands on the next render; place the caret after it does.
    requestAnimationFrame(() => {
      focusPromptDraft(el);
    });
  },
);
