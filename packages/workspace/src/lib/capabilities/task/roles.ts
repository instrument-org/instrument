/**
 * Where every `task.*` capability exists: the chat's session alone. A task
 * reports to its chat, and there are no tasks within a task.
 */
export const TASKS_ARE_THE_CHATS = {
  roleRefusal:
    "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
  roles: ["chat"],
} as const;
