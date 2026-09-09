import { PageOpenContext } from "@/client/components/page-open-context";
import { useTaskPaneActions } from "@/client/hooks/use-task-pane";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type StoreId,
  type TaskId,
  TaskPane,
} from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { useContext } from "react";
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
  sessionId?: StoreId.Session;
  taskId?: TaskId;
}) {
  // A window without a task pane says where a page goes instead.
  const openPage = useContext(PageOpenContext);
  const { selectTab } = useTaskPaneActions(taskId);
  // The call is reached inside the mutation rather than through the client's
  // own options builder, which reads the route at render: this hook now runs
  // over every link in the app, including the ones drawn where the task half of
  // the client is not there to be read.
  const { mutate: openBrowser } = useMutation({
    mutationFn: (input: {
      id: TaskId;
      sessionId: StoreId.Session;
      url: string;
    }) => rpcClient.workspace.browser.open.call(input),
    onError: () => {
      toast.error(`Unable to open the link in ${APP_NAME}`);
    },
  });

  return (url: string) => {
    if (openPage) {
      openPage(url);
      return;
    }
    // Outside a task and outside a window that says where pages go, there is
    // nowhere in the app to put one; the caller offers the OS browser instead.
    if (!taskId || !sessionId) {
      return;
    }
    selectTab(BROWSER_TAB_KEY);
    openBrowser({ id: taskId, sessionId, url });
  };
}
