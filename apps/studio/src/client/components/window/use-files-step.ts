import { useNavigate, useSearch } from "@tanstack/react-router";

import { type FilesIntent, nextStep } from "./files-step";

/**
 * Moves the Files tab the way a change asks, through its address: a step of
 * its own, the step on screen changed, or nothing when it is already there.
 */
export function useGoFiles() {
  const navigate = useNavigate();
  const shown = useSearch({ from: "/_app/files" });
  return (intent: FilesIntent, { replace }: { replace?: boolean } = {}) => {
    const { write } = nextStep(shown, intent);
    if (write === "none") {
      return;
    }
    void navigate({
      from: "/files",
      replace: replace ?? write === "replace",
      search: (previous) => nextStep(previous, intent).step,
      to: "/files",
    });
  };
}
