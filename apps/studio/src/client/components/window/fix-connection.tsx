import { Button } from "@/client/components/ui/button";
import { chatListOptions } from "@/client/components/window/chat-list-query";
import { WindowContext } from "@/client/components/window/context";
import { useGroupTab } from "@/client/components/window/group-tab";
import { appMentionToken } from "@/client/lib/app-mention";
import { cn } from "@/client/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { useContext, useEffect, useState } from "react";

/**
 * The connections a chat's card handed to Instrument, by slug, with when the
 * app's connection record was last written then.
 */
const fixesAskedAtom = atom<ReadonlyMap<string, number | undefined>>(new Map());

/** How long after the press the chat has to start on it. */
const STARTS_WITHIN_MS = 5000;

/**
 * Asks Instrument for another way to connect an app: inside a chat the line
 * is sent there, and anywhere else it waits in a draft. `isFixing` holds in
 * the chat for as long as it works and the app stands as it did.
 */
export function useFixConnection({
  name,
  slug,
  updatedAt,
}: {
  name: string;
  slug: string;
  updatedAt: number | undefined;
}) {
  const appWindow = useContext(WindowContext);
  const from = useGroupTab()?.id;
  const chatId = appWindow?.chatId;
  const [asked, setAsked] = useAtom(fixesAskedAtom);
  const [isStarting, setIsStarting] = useState(false);
  const isAsked =
    chatId !== undefined && asked.has(slug) && asked.get(slug) === updatedAt;
  const { data: isWorking = false } = useQuery({
    ...chatListOptions(),
    enabled: isAsked,
    select: (chats) =>
      chats.find((chat) => chat.id === chatId)?.status === "working",
  });
  useEffect(() => {
    if (!isStarting) {
      return;
    }
    const timer = setTimeout(() => {
      setIsStarting(false);
    }, STARTS_WITHIN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isStarting]);
  const isFixing = isAsked && (isStarting || isWorking);

  const fix = () => {
    if (chatId !== undefined) {
      setAsked((current) => new Map(current).set(slug, updatedAt));
      setIsStarting(true);
    }
    appWindow?.ask(
      `${appMentionToken({ name, slug })} didn't connect. Look for another way to connect it.`,
      { from },
    );
  };
  return { fix, isFixing };
}

export function FixWithInstrumentButton({
  className,
  onClick,
  ref,
}: {
  className?: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      className={cn("text-foreground", className)}
      onClick={onClick}
      ref={ref}
      size="sm"
      variant="outline"
    >
      Fix with Instrument
    </Button>
  );
}
