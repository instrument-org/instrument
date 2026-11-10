import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { openFindForKeyboard } from "@/client/lib/find-targets";
import { renderInBrowser } from "@/tests/render-browser";
import {
  type ChatId,
  StoreId,
  type TurnMatches,
} from "@instrument-org/workspace/client";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import "../../styles/globals.css";
import { ChatFind } from "./chat-find";

// What the records say about turns the transcript has not loaded.
const rpc = vi.hoisted(() => ({
  find: vi.fn<(input: { query: string }) => Promise<TurnMatches[]>>(),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      message: {
        find: {
          queryOptions: ({ input }: { input: unknown }) => ({
            queryFn:
              typeof input === "symbol"
                ? input
                : () => rpc.find(input as never),
            queryKey: ["message.find", input],
          }),
        },
      },
    },
  },
}));

const CHAT = "chat_01M6Y425TKVX7ETRAJ07DGTRNP" as ChatId;
const SESSION = StoreId.newSessionId();

/** A turn's words, and those its Worked row folds away until opened. */
type Turn = { folded?: string; id: StoreId.Message; text: string };

const filler = (label: string) =>
  `${label}. ${"Some words that fill the turn out. ".repeat(12)}`;

/**
 * A chat's conversation as the find sees it: a scroller of turns, each an
 * item named by its message, under a surface Cmd+F reaches, with the turns
 * before `held` loaded only when asked for, as the feed loads them.
 */
function Conversation({
  held: initiallyHeld,
  older = [],
}: {
  held: Turn[];
  older?: Turn[];
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [held, setHeld] = useState(initiallyHeld);
  const unheld = older.filter((turn) => !held.includes(turn));
  return (
    <div data-find-surface ref={surfaceRef} style={{ height: 300, width: 360 }}>
      <MessageScrollerProvider defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent ref={contentRef}>
              {held.map((turn) => (
                <MessageScrollerItem key={turn.id} messageId={turn.id}>
                  <p>{turn.text}</p>
                  {turn.folded !== undefined && opened.has(turn.id) && (
                    <p>{turn.folded}</p>
                  )}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <ChatFind
            chatId={CHAT}
            contentRef={contentRef}
            hasOlder={unheld.length > 0}
            loadOlderThrough={async (id) => {
              await Promise.resolve();
              const at = older.findIndex((turn) => turn.id === id);
              setHeld([...older.slice(at), ...initiallyHeld]);
              return at !== -1;
            }}
            loadedIds={new Set(held.map((turn) => turn.id))}
            onClose={() => undefined}
            onFoldsToOpen={setOpened}
            onOpenChange={setOpen}
            open={open}
            sessionId={SESSION}
            surfaceRef={surfaceRef}
          />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

const turn = (text: string): Turn => ({ id: StoreId.newMessageId(), text });

const field = () => page.getByPlaceholder("Find in chat");
const readout = () => document.querySelector("[aria-live=polite]")?.textContent;
const viewport = () =>
  document.querySelector<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );

/** Whether the text of the active highlight is in the scroller's view. */
function activeMatchInView(): boolean {
  const [name] = [...CSS.highlights.keys()].filter((key) =>
    key.startsWith("chat-find-active"),
  );
  const range = name ? [...(CSS.highlights.get(name) ?? [])][0] : undefined;
  const view = viewport()?.getBoundingClientRect();
  if (!(range instanceof Range) || !view) {
    return false;
  }
  const rect = range.getBoundingClientRect();
  return rect.top >= view.top && rect.bottom <= view.bottom;
}

beforeEach(() => {
  rpc.find.mockResolvedValue([]);
});

afterEach(() => {
  rpc.find.mockReset();
});

describe("ChatFind", () => {
  it("opens on Cmd+F and steps through the drawn matches, bringing each into view", async () => {
    await renderInBrowser(
      <Conversation
        held={[
          turn(`Apple at the top. ${filler("One")}`),
          turn(filler("Two")),
          turn(`An apple at the end. ${filler("Three")}`),
        ]}
      />,
    );
    // The keyboard in the conversation, as in its composer.
    viewport()?.focus();
    expect(openFindForKeyboard()).toBe(true);
    await expect.element(field()).toHaveFocus();

    await userEvent.keyboard("apple");
    // At the end, so the find starts on the match in view.
    await expect.poll(readout).toBe("2 of 2");
    expect(activeMatchInView()).toBe(true);

    await userEvent.keyboard("{Enter}");
    await expect.poll(readout).toBe("1 of 2");
    await expect.poll(activeMatchInView).toBe(true);

    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.poll(readout).toBe("2 of 2");
    await expect.poll(activeMatchInView).toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect.element(field()).not.toBeInTheDocument();
    expect(
      [...CSS.highlights.keys()].filter((key) => key.startsWith("chat-find")),
    ).toEqual([]);
  });

  it("counts matches in turns not loaded yet and loads the one a step reaches", async () => {
    const early = turn(`The apple turn from long ago. ${filler("Early")}`);
    const middle = turn(filler("Middle"));
    rpc.find.mockResolvedValue([{ count: 1, folded: 0, id: early.id }]);
    await renderInBrowser(
      <Conversation
        held={[turn(`An apple today. ${filler("Today")}`)]}
        older={[early, middle]}
      />,
    );
    viewport()?.focus();
    openFindForKeyboard();
    await expect.element(field()).toHaveFocus();
    await userEvent.keyboard("apple");
    await expect.poll(readout).toBe("2 of 2");
    expect(document.body.textContent).not.toContain("long ago");

    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.poll(readout).toBe("1 of 2");
    expect(document.body.textContent).toContain("long ago");
    await expect.poll(activeMatchInView).toBe(true);

    // On from the last match wraps round to the first.
    await userEvent.keyboard("{Enter}");
    await expect.poll(readout).toBe("2 of 2");
    await userEvent.keyboard("{Enter}");
    await expect.poll(readout).toBe("1 of 2");
  });

  it("goes up to a match above when none is drawn", async () => {
    const early = turn(`A pear from long ago. ${filler("Early")}`);
    rpc.find.mockResolvedValue([{ count: 1, folded: 0, id: early.id }]);
    await renderInBrowser(
      <Conversation held={[turn(filler("Today"))]} older={[early]} />,
    );
    viewport()?.focus();
    openFindForKeyboard();
    await expect.element(field()).toHaveFocus();
    await userEvent.keyboard("pear");
    await expect.poll(readout).toBe("1 of 1");
    await expect.poll(activeMatchInView).toBe(true);
  });

  it("opens the folded work holding a match, and folds it again on close", async () => {
    const worked = {
      ...turn(`Today's turn. ${filler("Today")}`),
      folded: "Checked the quokka enclosure.",
    };
    rpc.find.mockResolvedValue([{ count: 1, folded: 1, id: worked.id }]);
    await renderInBrowser(<Conversation held={[worked]} />);
    viewport()?.focus();
    openFindForKeyboard();
    await expect.element(field()).toHaveFocus();
    expect(document.body.textContent).not.toContain("quokka");
    await userEvent.keyboard("quokka");
    await expect.poll(readout).toBe("1 of 1");
    await expect.poll(activeMatchInView).toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.body.textContent).not.toContain("quokka");
  });
});
