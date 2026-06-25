import { atomWithStorage } from "jotai/utils";

export const projectsSectionOpenAtom = atomWithStorage(
  "projects-section-open",
  true,
);
