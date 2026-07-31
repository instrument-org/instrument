import { createContext, useContext, useEffect, useRef } from "react";

/**
 * A viewer's own selection, for the context menu wrapping it.
 *
 * Only formats whose selection is invisible to the browser need this. A PDF
 * page is a bitmap and its selection lives in pdfium, so `document.getSelection`
 * is empty and Chromium's own menu offers no Copy however much text is
 * highlighted. Formats that render real DOM text keep the native menu and need
 * none of this.
 */
export interface ViewerSelectionApi {
  copy: () => void;
  hasSelection: () => boolean;
}

/**
 * Set by the context menu, called by the viewer inside it. The menu is the
 * outer component, so the API has to travel up rather than down.
 */
export const ViewerSelectionRegistry = createContext<
  ((api: null | ViewerSelectionApi) => void) | null
>(null);

/**
 * Publishes a viewer's selection commands to the context menu above it.
 *
 * Registers once and dispatches through a ref, so a viewer that rebuilds these
 * closures every render does not re-register on every render.
 */
export function useRegisterViewerSelection(api: ViewerSelectionApi) {
  const register = useContext(ViewerSelectionRegistry);
  const latest = useRef(api);

  useEffect(() => {
    latest.current = api;
  });

  useEffect(() => {
    if (!register) {
      return;
    }
    register({
      copy: () => {
        latest.current.copy();
      },
      hasSelection: () => latest.current.hasSelection(),
    });
    return () => {
      register(null);
    };
  }, [register]);
}
