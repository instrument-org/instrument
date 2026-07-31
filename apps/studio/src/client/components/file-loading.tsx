import { useEffect, useState } from "react";

import { Spinner } from "./ui/spinner";

// Long enough that switching between files already on disk never reaches it,
// short enough that a wait which does reach it has not yet started to read as
// nothing happening.
const SPINNER_DELAY_MS = 500;

/**
 * The wait every file shows on its way into the artifact panel, whichever
 * viewer is about to render it.
 *
 * Nothing at all for the first half second, then a spinner. Most of these waits
 * are over well before that: a file already parsed, or a small one, appears in
 * a frame or two, and anything drawn in that window is a flicker between two
 * documents rather than a sign of progress. What is left after the delay are
 * the waits long enough to look broken without it -- the first PDF of a
 * session, which compiles pdfium, or a large workbook.
 *
 * The delay restarts with each mount, so it is per file rather than per panel:
 * flipping quickly through several files shows nothing throughout.
 */
export function FileLoading() {
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSpinner(true);
    }, SPINNER_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (!showSpinner) {
    return null;
  }

  return (
    <div className="flex size-full items-center justify-center">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
}
