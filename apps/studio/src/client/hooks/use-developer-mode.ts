import { preferencesAtom } from "@/client/atoms/preferences";
import { useAtomValue } from "jotai";

export function useDeveloperMode() {
  return useAtomValue(preferencesAtom).developerMode;
}
