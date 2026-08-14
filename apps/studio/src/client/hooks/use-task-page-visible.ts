import { useIsActiveTab } from "@/client/hooks/use-active-tab";

/**
 * Whether the task page this is called from is the one on screen.
 *
 * The task's browser guest lives outside the React tree (body-mounted, see
 * browser-pool) and the main process reaps it on a clock that depends on
 * whether anyone is looking, so both the guest's paint slot and its presence
 * lease need an answer their own DOM can't give them. Today the app draws one
 * task per foreground tab and that answer is the active tab; if the shell stops
 * being tabs, this is the one place that has to learn the new one.
 */
export function useIsTaskPageVisible() {
  return useIsActiveTab();
}
