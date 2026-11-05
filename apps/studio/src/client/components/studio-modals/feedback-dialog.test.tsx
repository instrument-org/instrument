import { reportDialogAtom } from "@/client/atoms/report-dialog";
import { modalBackStackAtom } from "@/client/atoms/tab-navigation-block";
import { ReportDialog } from "@/client/components/studio-modals/report-dialog";
import { feedbackReport } from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { type FeedbackItem, type FeedbackTag } from "@/shared/problem-reports";
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
                    content: `${[
                      { message: { role: "user" }, seq: 0, t: "message" },
                      {
                        part: { text: "favorite my first email", type: "text" },
                        seq: 1,
                        t: "part",
                      },
                      {
                        part: {
                          input: { command: "app test gmail" },
                          type: "tool-bash",
                        },
                        seq: 2,
                        t: "part",
                      },
                    ]
                      .map((record) => JSON.stringify(record))
                      .join("\n")}\n`,
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
  useDictatedText: () => ({ phase: { kind: "idle" } }),
}));

async function open(
  writeup?: { text: string; title: string },
  tag?: FeedbackTag,
) {
  renderWithDefaultStore(<ReportDialog />);
  act(() => {
    getDefaultStore().set(
      reportDialogAtom,
      feedbackReport({ surface: "test", tag, writeup }),
    );
  });
  await screen.findByRole("button", { name: "View Diagnostics" });
}

describe("FeedbackDialogContent", () => {
  const pressed = () =>
    screen
      .getAllByRole("button", { pressed: true })
      .map((chip) => chip.textContent);

  it("opens with the card's answer tagged and asks its question", async () => {
    await open(undefined, "bad");
    expect(pressed()).toEqual(["Bad result"]);
    expect(screen.getByPlaceholderText("What went wrong?")).toBeTruthy();
  });

  it("lets a person pick one tag, change it, or take it off", async () => {
    await open();
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Idea" }));
    expect(pressed()).toEqual(["Idea"]);
    fireEvent.click(screen.getByRole("button", { name: "Too slow" }));
    expect(pressed()).toEqual(["Too slow"]);
    fireEvent.click(screen.getByRole("button", { name: "Too slow" }));
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
  });

  it("lists the chat by its title and the diagnostics, with nothing to check", async () => {
    await open();
    expect(screen.getByText("“Star my first email”")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the chat on a page of its own, steps folded, and goes back", async () => {
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "View “Star my first email”" }),
    );
    expect(
      screen.getByRole("heading", { name: "“Star my first email”" }),
    ).toBeTruthy();
    expect(screen.getByText("favorite my first email")).toBeTruthy();
    expect(screen.queryByText("app test gmail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 step/ }));
    expect(screen.getByText("app test gmail")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Send feedback")).toBeTruthy();
  });

  it("steps back from the review to the form on a back press, as Settings does", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "View Diagnostics" }));
    act(() => {
      getDefaultStore().get(modalBackStackAtom).at(-1)?.run();
    });
    expect(screen.getByText("Send feedback")).toBeTruthy();
  });

  it("closes on Send and leaves the rest to a toast", async () => {
    const work = vi.spyOn(toast, "work");
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(getDefaultStore().get(reportDialogAtom)).toBeNull();
    expect(work.mock.calls[0]?.[0]).toMatchObject({
      done: "Thanks, we got your feedback.",
      failed: "Couldn't send your feedback",
      running: "Sending your feedback…",
    });
  });

  it("lists the agent's write-up first when there is one", async () => {
    await open({ text: "The tab crashed.", title: "Tab crashed" });
    const views = screen
      .getAllByRole("button", { name: /^View / })
      .map((button) => button.getAttribute("aria-label"));
    expect(views).toEqual([
      "View Instrument's write-up",
      "View “Star my first email”",
      "View Diagnostics",
    ]);
  });
});
