import { atomWithStorage } from "jotai/utils";

export const projectsSectionOpenAtom = atomWithStorage(
  "studio.projects-section-open.v1",
  true,
);
