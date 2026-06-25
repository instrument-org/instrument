import { atomWithStorage } from "jotai/utils";

// Persisted (localStorage) so the Projects sidebar section keeps its
// expanded/collapsed state across reloads and app restarts.
export const projectsSectionOpenAtom = atomWithStorage(
  "projects-section-open",
  true,
);
