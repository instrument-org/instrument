import { useTaskPaneActions } from "@/client/hooks/use-task-pane";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type StoreId,
  type TaskId,
  TaskPane,
} from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

const BROWSER_TAB_KEY = TaskPane.tabKey({ type: "browser" });

/**
 * Send a page to this task's own browser and bring it into view.
 *
 * Two steps in one direction rather than a sequence: the pane is revealed
 * immediately from the click, and the page is handed to `browser.open`, which
 * creates the guest if it is not there and navigates once it has attached.
 * Navigating from here instead would mean waiting on the renderer's pool for a
 * `<webview>` that the first of these two steps has only just asked for.
 *
 * `selectTab` opens the pane as well as focusing the tab, and the browser is a
 * fixed tab the pane always draws, so this needs nothing to exist first.
 */
export function useOpenInTaskBrowser({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  const { selectTab } = useTaskPaneActions(taskId);
  const { mutate: openBrowser } = useMutation(
    rpcClient.workspace.browser.open.mutationOptions({
      onError: () => {
        toast.error(`Unable to open the link in ${APP_NAME}`);
      },
    }),
  );

  return (url: string) => {
    selectTab(BROWSER_TAB_KEY);
    openBrowser({ id: taskId, sessionId, url });
  };
}
