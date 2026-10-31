import { reportDialogAtom } from "@/client/atoms/report-dialog";
import { listedSources } from "@/client/components/studio-modals/feedback-dialog";
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
              full: item("chat-full", "chat", "This chat", "the page it read"),
              item: item("chat", "chat", "This chat", "the chat's steps"),
              sources: ["mail.google.com", "Gmail"],
              summary: "“Star my first email” and 1 task",
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
  await screen.findByRole("button", { name: "Read Diagnostics" });
}

describe("FeedbackDialogContent", () => {
  it("offers the chat and the diagnostics as one row each, the chat named by its title", async () => {
    await open();
    expect(screen.getByText("“Star my first email” and 1 task")).toBeTruthy();
    expect(screen.getByText("the chat's steps")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read Diagnostics" }));
    expect(screen.getByText("the app's log")).toBeTruthy();
    expect(screen.queryByText("the chat's steps")).toBeNull();
  });

  it("sends what the agent read only once Include full details is checked", async () => {
    await open();
    const box = screen.getByRole("checkbox", { name: "Include full details" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("the page it read")).toBeNull();
    fireEvent.click(box);
    expect(screen.getByText("the page it read")).toBeTruthy();
    expect(screen.queryByText("the chat's steps")).toBeNull();
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

describe("listedSources", () => {
  it.each([
    [[], ""],
    [["mail.google.com"], "mail.google.com"],
    [["mail.google.com", "Gmail"], "mail.google.com and Gmail"],
    [["a.com", "b.com", "Gmail", "2 files"], "a.com, b.com and Gmail"],
  ])("%j", (sources, listed) => {
    expect(listedSources(sources)).toBe(listed);
  });
});
