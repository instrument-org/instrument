import { INBOX_HREF } from "@/client/components/window/app-tabs";
import { ChatTasksScreen } from "@/client/components/window/chat-tasks-view";
import { chatOfTasksList } from "@/client/components/window/tab-location";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * A chat's tasks, as a tab in the chat's group. The list is always one
 * chat's: an address that names no chat, or not one, goes to the inbox.
 */
export const Route = createFileRoute("/_app/tasks/")({
  beforeLoad: ({ search }) => {
    if (chatOfTasksList(search.chat) === undefined) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ href: INBOX_HREF, replace: true });
    }
  },
  component: TasksRoute,
  validateSearch: z.object({
    /** The chat whose tasks are listed, by session id. */
    chat: z.string().optional(),
  }),
});

function TasksRoute() {
  const chat = chatOfTasksList(Route.useSearch().chat);
  return chat ? <ChatTasksScreen chat={chat} /> : null;
}
