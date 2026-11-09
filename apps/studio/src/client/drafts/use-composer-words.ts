import {
  draftKeyString,
  type PromptDraftKey,
  storedWordsAtom,
  typedWordsAtom,
} from "@/client/atoms/prompt-value";
import { useAtomValue, useSetAtom } from "jotai";
import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { cancelWords, flushWords, hasWaitingWords } from "./settle-words";

/**
 * The words the editor shows, which reach the draft a beat after they are
 * typed. The editor reads its text once, at mount, from what the draft has,
 * and every edit after that comes back through `setValue`; a composer moved
 * onto another draft starts again from that one's.
 */
export function useComposerWords(
  draftKey: PromptDraftKey,
  editor: RefObject<null | { setValue: (words: string) => void }>,
) {
  const keyed = draftKeyString(draftKey);
  const storedWords = useAtomValue(storedWordsAtom(draftKey));
  const typeWords = useSetAtom(typedWordsAtom);
  const [shown, setShown] = useState({ key: keyed, words: storedWords });
  if (shown.key !== keyed) {
    setShown({ key: keyed, words: storedWords });
  }
  const value = shown.key === keyed ? shown.words : storedWords;
  // A window is being typed in from its first key until it loses focus. One
  // only just come to the front is not: words typed in the window it came from
  // can still be on their way here.
  const isBeingTyped = useRef(false);
  useEffect(() => {
    const onBlur = () => {
      isBeingTyped.current = false;
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const setValue = (words: string) => {
    setShown({ key: keyed, words });
    // Back to what the draft has, which is also how words from another window
    // come in: nothing to write, and what was waiting to be is out of date.
    if (words === storedWords) {
      cancelWords(keyed);
    } else {
      isBeingTyped.current = true;
      typeWords({ key: draftKey, words });
    }
  };
  // A composer going, or moving onto another draft, writes what it was
  // typed into at once: the next one to show that draft starts from it.
  useEffect(
    () => () => {
      flushWords(keyed);
    },
    [keyed],
  );
  // The same chat's box in another window: what is typed there comes in here,
  // unless this is the window being typed in, or has words on their way.
  const takeStoredWords = useEffectEvent((words: string) => {
    if (words !== value && !isBeingTyped.current && !hasWaitingWords(keyed)) {
      editor.current?.setValue(words);
    }
  });
  useEffect(() => {
    // Only as the draft changes: typing here reaches it a beat after `value`.
    takeStoredWords(storedWords);
  }, [storedWords]);
  return { setValue, value };
}
