import { sharedQueryClient } from "@/client/lib/tab-router";
import { type BootMark } from "@/shared/constants";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { chatListOptions } from "./chat-list-query";

/** The marks this page load has sent, each sent once. */
const told = new Set<BootMark>();

function tell(mark: BootMark) {
  if (told.has(mark)) {
    return;
  }
  told.add(mark);
  window.api.bootMark?.(mark);
}

const isRead = () => true;

/**
 * Tells the main process when the window first rendered and when it first
 * rendered with the chat list read, which it logs beside its own boot steps:
 * the launch past the window's first paint, up to when it is usable.
 */
export function useBootMarks() {
  const isListed =
    useQuery({ ...chatListOptions(), select: isRead }, sharedQueryClient)
      .data === true;
  useEffect(() => {
    tell("first render");
  }, []);
  useEffect(() => {
    if (isListed) {
      tell("chat list read");
    }
  }, [isListed]);
}
