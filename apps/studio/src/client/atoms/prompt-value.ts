import { type TabId } from "@/shared/tabs";
import {
  MAX_PROMPT_STORAGE_LENGTH,
  type TaskId,
} from "@instrument-org/workspace/client";
import { atom, type SetStateAction } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
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

const createTaskPromptStorage = (id: TaskId) => {
  let lastValue: string | undefined;

  const save = debounce({ delay: 1000 }, async (newValue: string) => {
    await rpcClient.workspace.task.state.set.call({
      id,
      state: { promptDraft: newValue },
    });
  });

  return {
    getItem: (_key: string, initialValue: string) => {
      return lastValue ?? initialValue;
    },
    removeItem: (_key: string) => {
      lastValue = undefined;
      save("");
    },
    setItem: (_key: string, newValue: string) => {
      lastValue = newValue;
      if (newValue.length > MAX_PROMPT_STORAGE_LENGTH) {
        return;
      }
      save(newValue);
    },
    // Using subscribe to avoid making this an async storage. Easier for consumer
    // and the persistence of this is not critical.
    subscribe: (
      _key: string,
      callback: (value: string) => void,
      initialValue: string,
    ) => {
      let isCancelled = false;
      rpcClient.workspace.task.state.get
        .call({ id })
        .then((state) => {
          if (isCancelled) {
            return;
          }
          const newValue = state.promptDraft ?? initialValue;
          if (lastValue === undefined) {
            lastValue = newValue;
            callback(newValue);
          }
        })
        .catch(() => {
          // ignore
        });
      return () => {
        isCancelled = true;
      };
    },
  };
};

// Ephemeral, in-memory compose drafts, one per tab.
const composeDraftFamily = atomFamily((_tabId: TabId) => atom(""));

// Transient drafts, discarded by the composer when it unmounts or re-keys.
const transientDraftFamily = atomFamily((_id: string) => atom(""));

/** Drop a transient draft so re-opening the surface starts from its prefill. */
export function removeTransientDraft(id: string) {
  transientDraftFamily.remove(id);
}

// Task follow-up drafts, persisted with the task via task-state storage.
export const taskDraftFamily = atomFamily((taskId: TaskId) =>
  atomWithStorage(
    `prompt-draft-${taskId}`,
    "",
    createTaskPromptStorage(taskId),
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
