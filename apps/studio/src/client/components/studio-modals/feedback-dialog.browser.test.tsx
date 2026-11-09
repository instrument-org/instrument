import { Dialog } from "@/client/components/ui/dialog";
import { renderInBrowser } from "@/tests/render-browser";
import { type FeedbackItem, MAX_REPORT_BYTES } from "@/shared/problem-reports";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

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

// A chat whose records are more than a report may carry, as the Windows test
// PC's was.
const described = () => ({
  chat: {
    item: item("chat", "chat", MAX_REPORT_BYTES + 1),
    title: "“A long chat”",
  },
  diagnostics: item("diagnostics", "diagnostics", 100),
});

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
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

vi.mock("@/client/components/dictation-controls", async () => {
  const { Textarea } = await import("@/client/components/ui/textarea");
  return {
    DictatedTextarea: ({
      dictation: _,
      ...props
    }: React.ComponentProps<typeof Textarea> & { dictation: unknown }) => (
      <Textarea {...props} />
    ),
    useDictatedText: () => ({ phase: { kind: "idle" } }),
  };
});

async function open({ stuck = false } = {}) {
  rpc.stuck = stuck;
  const screen = await renderInBrowser(
    <Dialog open>
      <FeedbackDialogContent
        onClose={() => {}}
        onExitComplete={() => {}}
        request={{ chatId: undefined, kind: "feedback", surface: "test" }}
      />
    </Dialog>,
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

  it("sends without a chat too big to go, and says so", async () => {
    const screen = await open();
    await expect
      .element(
        screen.getByText(
          "This chat is too big to send, so your feedback will go without it.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "View “A long chat”" }))
      .not.toBeInTheDocument();
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
    ).toEqual(["diagnostics"]);
  });
});
