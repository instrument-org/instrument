import { reportDialogAtom } from "@/client/atoms/report-dialog";
import { ReportDialog } from "@/client/components/studio-modals/report-dialog";
import { feedbackReport } from "@/client/lib/problem-reports";
import { type FeedbackItem } from "@/shared/problem-reports";
import { renderWithDefaultStore } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

const item = (
  id: string,
  kind: FeedbackItem["kind"],
  label: string,
  content: string,
) =>
  ({
    bytes: content.length,
    files: [{ content, path: `${id}.txt` }],
    id,
    kind,
    label,
  }) satisfies FeedbackItem;

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    problems: {
      describeFeedback: {
        queryOptions: () => ({
          queryFn: () => ({
            chat: {
              item: {
                bytes: 100,
                files: [
                  {
                    content: `${JSON.stringify({ part: { text: "favorite my first email", type: "text" }, seq: 1, t: "part" })}\n`,
                    label: "“Star my first email”",
                    path: "chat/ses_1.mac.jsonl",
                  },
                ],
                id: "chat",
                kind: "chat",
                label: "This chat",
              },
              title: "“Star my first email”",
            },
            diagnostics: item(
              "diagnostics",
              "diagnostics",
              "Diagnostics",
              "the app's log",
            ),
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
  await screen.findByRole("button", { name: "View Diagnostics" });
}

describe("FeedbackDialogContent", () => {
  it("lists the chat by its title and the diagnostics, with nothing to check", async () => {
    await open();
    expect(screen.getByText("“Star my first email”")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the chat a record a row on its own page, and goes back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "View This chat" }));
    expect(screen.getByText("What we'll send")).toBeTruthy();
    expect(screen.getByText("favorite my first email")).toBeTruthy();
    // A tab takes the press, as Radix has it, rather than the click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(screen.queryByText("favorite my first email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Send feedback")).toBeTruthy();
  });

  it("lists the agent's write-up first when there is one", async () => {
    await open({ text: "The tab crashed.", title: "Tab crashed" });
    const views = screen
      .getAllByRole("button", { name: /^View / })
      .map((button) => button.getAttribute("aria-label"));
    expect(views).toEqual([
      "View Write-up",
      "View This chat",
      "View Diagnostics",
    ]);
  });
});
