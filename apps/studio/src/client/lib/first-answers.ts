import { chatListOptions } from "@/client/components/window/chat-list-query";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { sharedQueryClient } from "@/client/lib/tab-router";
import { rpcClient } from "@/client/rpc/client";

/**
 * The longest an app window's first render waits on main's first answers: a
 * frame or two past what they usually take as the app launches, so a main
 * process slow to answer costs no more than that before the window draws
 * what it has.
 */
const FIRST_ANSWERS_WAIT_MS = 120;

/**
 * Asks main for what an app window first draws, before React has rendered
 * anything to ask from, and settles once what its layout stands on is in
 * the cache, or after `FIRST_ANSWERS_WAIT_MS`. Asked as the render begins,
 * those land just after it, and the window draws a frame without them first:
 * its loading frame, whose card stands where no card of the window stands,
 * and the sidebar without its projects, which then push the rows below them
 * down. Meanwhile the window shows its shape (`shared/launch-shape.ts`).
 *
 * The chat list and the side panel's answers are asked too and not waited
 * on: the list would otherwise start only once the wait is over, and asked
 * as the panel mounts, a frame after the window, each section would land
 * later still and push the ones below it down.
 */
export function firstAnswers(): Promise<void> {
  // A first launch's window has no workspace to ask until setup places it.
  if (window.api.initialSetupState?.facts.hasWorkspace === false) {
    return Promise.resolve();
  }
  const client = sharedQueryClient;
  // Never settles: it follows the list for as long as the window is up.
  void client.prefetchQuery(chatListOptions());
  void client.prefetchQuery(
    rpcClient.apps.live.list.experimental_liveOptions(),
  );
  void client.prefetchQuery(
    rpcClient.apps.live.catalogMarks.experimental_liveOptions(),
  );
  void client.prefetchQuery(
    rpcClient.chatgptAccount.live.status.experimental_liveOptions(),
  );
  void client.prefetchQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  void client.prefetchQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  // Read again only when main says they changed, as the window sets for them
  // too; set here so the Files section mounting on these does not ask again.
  client.setQueryDefaults(rpcClient.workspace.computer.places.key(), {
    staleTime: Number.POSITIVE_INFINITY,
  });
  void client.prefetchQuery(rpcClient.workspace.computer.places.queryOptions());
  void client.prefetchQuery(storageLocationQueryOptions());
  const answered = Promise.allSettled([
    client.prefetchQuery(
      rpcClient.workspace.window.ensure.queryOptions({
        staleTime: Number.POSITIVE_INFINITY,
      }),
    ),
    client.prefetchQuery(rpcClient.workspace.projects.list.queryOptions()),
  ]);
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, FIRST_ANSWERS_WAIT_MS);
    void answered.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
