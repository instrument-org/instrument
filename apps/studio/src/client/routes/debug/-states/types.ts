/** One state a debug page draws, which has an address of its own. */
export interface DebugStateEntry {
  /** The `?state=` it is reached at, unique on its page. */
  id: string;
  label: string;
  /** The page's tab it is drawn under, on a page with tabs. */
  tab?: string;
}
