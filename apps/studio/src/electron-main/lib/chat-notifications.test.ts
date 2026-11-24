import { ChatIdSchema } from "@instrument-org/workspace/electron";
import { expect, it, vi } from "vitest";

import { createChatNotifications } from "./chat-notifications";

const CHAT = ChatIdSchema.parse("groceries");
const OTHER = ChatIdSchema.parse("trip");

function shown({ overApp = false } = {}) {
  const notifications = createChatNotifications();
  const close = vi.fn<() => void>();
  const remove = notifications.add(CHAT, { close, overApp });
  return { close, notifications, remove };
}

it("closes a chat's notification once the chat is read", () => {
  const { close, notifications } = shown();
  notifications.chatRead(OTHER, { inFront: true });
  expect(close).not.toHaveBeenCalled();
  notifications.chatRead(CHAT, { inFront: true });
  notifications.chatRead(CHAT, { inFront: true });
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps one read behind another app until the app comes forward", () => {
  const { close, notifications } = shown();
  notifications.chatRead(CHAT, { inFront: false });
  expect(close).not.toHaveBeenCalled();
  notifications.appCameForward();
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps an unread chat's notification as the app comes forward", () => {
  const { close, notifications } = shown();
  notifications.appCameForward();
  expect(close).not.toHaveBeenCalled();
});

it("keeps one put up over the app", () => {
  const { close, notifications } = shown({ overApp: true });
  notifications.chatRead(CHAT, { inFront: true });
  expect(close).not.toHaveBeenCalled();
});

it("leaves alone one the person already answered", () => {
  const { close, notifications, remove } = shown();
  remove();
  notifications.chatRead(CHAT, { inFront: true });
  expect(close).not.toHaveBeenCalled();
});
