import {
  MAX_PROMPT_STORAGE_LENGTH,
  type TaskId,
} from "@instrument-org/workspace/client";
import { atom, type SetStateAction } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { debounce } from "radashi";

import { rpcClient } from "../rpc/client";

export type PromptValueAtomKey =
  | "$$new-tab$$"
  | "$$template$$"
  | `$$project:${string}$$`
  | TaskId;

export const promptInputRefAtom = atom<HTMLTextAreaElement | null>(null);

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

// Sentinel keys (new-tab, template, per-project) get ephemeral in-memory drafts;
// only real tasks back their draft with task-state storage.
function isEphemeralKey(
  key: PromptValueAtomKey,
): key is "$$new-tab$$" | "$$template$$" | `$$project:${string}$$` {
  return (
    key === "$$new-tab$$" ||
    key === "$$template$$" ||
    key.startsWith("$$project:")
  );
}

export const promptValueAtomFamily = atomFamily((key: PromptValueAtomKey) => {
  if (isEphemeralKey(key)) {
    return atom("");
  }

  return atomWithStorage(
    `prompt-draft-${key}`,
    "",
    createTaskPromptStorage(key),
  );
});

export const appendToPromptAtom = atom(
  null,
  (
    get,
    set,
    {
      key,
      update,
    }: { key: PromptValueAtomKey; update: SetStateAction<string> },
  ) => {
    const valueAtom = promptValueAtomFamily(key);
    const prev = get(valueAtom);
    const next =
      typeof update === "function"
        ? update(prev)
        : (prev.trimEnd() ? prev.trimEnd() + " " : "") + update.trim() + " ";
    set(valueAtom, next);
    get(promptInputRefAtom)?.focus();
  },
);
