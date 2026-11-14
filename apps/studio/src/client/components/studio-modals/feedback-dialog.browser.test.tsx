import { zoomAtom } from "@/client/atoms/zoom";
import { Dialog } from "@/client/components/ui/dialog";
import { ZoomRoot } from "@/client/components/zoom-root";
import { renderInBrowser } from "@/tests/render-browser";
import { type FeedbackItem, MAX_REPORT_BYTES } from "@/shared/problem-reports";
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { FeedbackDialogContent } from "./feedback-dialog";

const item = (id: string, kind: FeedbackItem["kind"], bytes: number) =>
  ({
    bytes,
    files: [{ content: id, path: `${id}.txt` }],
    id,
    kind,
    label: id,
  }) satisfies FeedbackItem;

const rpc = vi.hoisted(() => ({
  /** Whether the dialog's own gathering never settles. */
  stuck: false,
  sendFeedback: vi.fn<(input: { items: { id: string }[] }) => void>(),
}));

// A chat over the report's cap, as the Windows test PC's was, which the main
// process trims to fit before the dialog sees it.
const described = () => ({
  chat: {
    item: item("chat", "chat", MAX_REPORT_BYTES + 1),
    title: "“A long chat”",
  },
  diagnostics: item("diagnostics", "diagnostics", 100),
});

vi.mock("@/client/hooks/use-developer-mode", () => ({
  useDeveloperMode: () => false,
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    captures: {
      build: {
        queryOptions: () => ({
          queryFn: () => null,
          queryKey: ["captures.build"],
        }),
      },
    },
    problems: {
      describeFeedback: {
        call: async () => described(),
        queryOptions: () => ({
          queryFn: () =>
            rpc.stuck ? new Promise<never>(() => {}) : described(),
          queryKey: ["problems.describeFeedback"],
        }),
      },
      sendFeedback: { call: rpc.sendFeedback },
    },
  },
}));

vi.mock("@/client/components/dictation-controls", () => ({
  DictationControls: ({ className }: { className?: string }) => (
    <button aria-label="Dictate" className={className} type="button" />
  ),
  DictationReadout: () => null,
  useCanDictate: () => true,
  useDictatedText: () => ({ phase: { kind: "idle" } }),
}));

afterEach(async () => {
  await page.viewport(1280, 900);
});

async function open({ stuck = false, zoom = 1 } = {}) {
  rpc.stuck = stuck;
  const store = createStore();
  store.set(zoomAtom, zoom);
  const screen = await renderInBrowser(
    <ZoomRoot>
      <Dialog open>
        <FeedbackDialogContent
          onClose={() => {}}
          onExitComplete={() => {}}
          request={{ chatId: undefined, kind: "feedback", surface: "test" }}
        />
      </Dialog>
    </ZoomRoot>,
    { store },
  );
  if (!stuck) {
    await expect
      .element(screen.getByRole("button", { name: "View Diagnostics" }))
      .toBeVisible();
  }
  return screen;
}

describe("FeedbackDialogContent in a browser", () => {
  it("keeps Send in view while a long note grows the dialog", async () => {
    const screen = await open();
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Your note" }),
      "A line of what happened.\n".repeat(120),
    );

    const content = document
      .querySelector("[data-slot='dialog-content']")
      ?.getBoundingClientRect();
    const send = screen
      .getByRole("button", { name: "Send" })
      .element()
      .getBoundingClientRect();
    expect({
      inDialog: content !== undefined && send.bottom <= content.bottom,
      onScreen: send.bottom <= globalThis.innerHeight,
    }).toEqual({ inDialog: true, onScreen: true });
  });

  // A first-run session on a short window had the whole form scrolling, the
  // tags and what goes with the note sliding away with a long note.
  it.each([1, 1.5])(
    "on a short window at %sx, scrolls only the note as it grows",
    async (zoom) => {
      await page.viewport(1280, 640 * zoom);
      const screen = await open({ zoom });
      const note = screen.getByRole("textbox", { name: "Your note" });
      await userEvent.fill(note, "A line of what happened.\n".repeat(120));

      const box = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect();
      const body = document.querySelector("[data-slot='dialog-body']");
      const dialog = box("[data-slot='dialog-content']");
      const send = screen
        .getByRole("button", { name: "Send" })
        .element()
        .getBoundingClientRect();
      const dictate = screen
        .getByRole("button", { name: "Dictate" })
        .element()
        .getBoundingClientRect();
      const hint = screen
        .getByText("Add images, or paste or drop them here")
        .element()
        .getBoundingClientRect();
      const field = note.element();
      expect({
        bodyScrolls: body !== null && body.scrollHeight > body.clientHeight + 1,
        dictateBesideHint:
          dictate.top >= field.getBoundingClientRect().bottom &&
          Math.abs(
            (dictate.top + dictate.bottom) / 2 - (hint.top + hint.bottom) / 2,
          ) < 4,
        noteScrolls: field.scrollHeight > field.clientHeight,
        sendOnScreen:
          dialog !== undefined &&
          send.bottom <= dialog.bottom &&
          dialog.bottom <= globalThis.innerHeight,
      }).toEqual({
        bodyScrolls: false,
        dictateBesideHint: true,
        noteScrolls: true,
        sendOnScreen: true,
      });
    },
  );

  it("lists the chat under its own name, whatever its size", async () => {
    const screen = await open();
    await expect.element(screen.getByText("“A long chat”")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "View The chat" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Send" }))
      .toBeEnabled();
  });

  it("sends what it gathers when Send comes before the dialog has it", async () => {
    rpc.sendFeedback.mockClear();
    const screen = await open({ stuck: true });
    await screen.getByRole("button", { name: "Send" }).click();
    await vi.waitFor(() => {
      expect(rpc.sendFeedback).toHaveBeenCalled();
    });
    expect(
      rpc.sendFeedback.mock.calls[0]?.[0].items.map((each) => each.id),
    ).toEqual(["chat", "diagnostics"]);
  });
});
