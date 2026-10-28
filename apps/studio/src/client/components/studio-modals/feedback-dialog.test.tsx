import { reportDialogAtom } from "@/client/atoms/report-dialog";
import { ReportDialog } from "@/client/components/studio-modals/report-dialog";
import { feedbackReport } from "@/client/lib/problem-reports";
import { type FeedbackItem } from "@/shared/problem-reports";
import { renderWithDefaultStore } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

const item = (id: string, kind: FeedbackItem["kind"], content: string) =>
  ({
    bytes: content.length,
    files: [{ content, path: `${id}.txt` }],
    id,
    kind,
    label: `${id}.txt`,
  }) satisfies FeedbackItem;

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    problems: {
      describeFeedback: {
        queryOptions: () => ({
          queryFn: () => ({
            chat: { items: [item("messages", "chat", "the chat's messages")] },
            diagnostics: { items: [item("log", "log", "the app's log")] },
          }),
          queryKey: ["problems.describeFeedback"],
        }),
      },
      sendFeedback: { call: vi.fn() },
    },
  },
}));

vi.mock("@/client/components/dictation-controls", () => ({
  DictatedTextarea: ({ dictation: _, ...props }: { dictation: unknown }) => (
    <textarea {...props} />
  ),
  useDictatedText: () => ({ phase: "idle" }),
}));

async function open(writeup?: { text: string; title: string }) {
  renderWithDefaultStore(<ReportDialog />);
  act(() => {
    getDefaultStore().set(
      reportDialogAtom,
      feedbackReport({ surface: "test", writeup }),
    );
  });
  await screen.findByRole("button", { name: "Read log.txt" });
}

describe("FeedbackDialogContent", () => {
  it("shows the first file beside the list, and the one picked after", async () => {
    await open();
    expect(screen.getByText("the chat's messages")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read log.txt" }));
    expect(screen.getByText("the app's log")).toBeTruthy();
    expect(screen.queryByText("the chat's messages")).toBeNull();
  });

  it("opens on the agent's write-up when there is one", async () => {
    await open({ text: "The tab crashed.", title: "Tab crashed" });
    expect(
      screen
        .getByRole("button", { name: "Read writeup.md" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
