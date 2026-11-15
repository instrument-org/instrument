import { type CardFileVersion } from "@instrument-org/workspace/client";
import { createContext } from "react";

/**
 * The files a turn's reply handed over that its cards draw other than as
 * they are now, by the path the reply wrote (`cardFileVersions`). Absent
 * outside a transcript's turn.
 */
export const CardFileVersionsContext = createContext<
  ReadonlyMap<string, CardFileVersion> | undefined
>(undefined);
