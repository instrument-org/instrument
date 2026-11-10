import type { ReactNode } from "react";

import { APP_NAME } from "@instrument-org/shared";

/** Why a save of a file in an encoding the app only reads fails. */
export const CANT_SAVE_TEXT_FORMAT = `${APP_NAME} can’t save files in this text format`;

/** Why a file in an encoding the app only reads opens read only, in every editor. */
export const UNSAVEABLE_TEXT_NOTE = `${CANT_SAVE_TEXT_FORMAT}, so this one opens read only.`;

/** The line over a file's editor saying why it opens read only. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 px-4 py-2 text-xs text-muted-foreground viewer-chrome-stroke">
      {children}
    </div>
  );
}
