import {
  feedbackBarAtom,
  feedbackDraftAtom,
  openReportDialog,
  reportDialogAtom,
} from "@/client/atoms/report-dialog";
import { modalBackStackAtom } from "@/client/atoms/tab-navigation-block";
import { ReportDialog } from "@/client/components/studio-modals/report-dialog";
import { feedbackReport } from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type FeedbackItem, type FeedbackTag } from "@/shared/problem-reports";
import { renderWithDefaultStore } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { getDefaultStore } from "jotai";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
            actions: item(
              "actions",
              "actions",
              "Your activity",
              `${JSON.stringify({
                at: "2026-11-05T22:45:00.000Z",
                kind: "folder",
                path: "~/Downloads",
              })}\n`,
            ),
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
  DictationControls: () => null,
  DictationReadout: () => null,
  useCanDictate: () => true,
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
    fireEvent.click(screen.getByRole("button", { name: "View The chat" }));
    expect(screen.getByRole("heading", { name: "The chat" })).toBeTruthy();
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
      done: "Thanks! Feedback submitted.",
      failed: "Error sending your feedback",
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
      "View The chat",
      "View Your activity",
      "View Diagnostics",
    ]);
  });

  const sentItems = () =>
    vi
      .mocked(rpcClient.problems.sendFeedback.call)
      .mock.calls.at(-1)?.[0]
      .items.map((each) => each.id);

  it("sends what the person did in the app only when they switch it on", async () => {
    await open();
    expect(
      screen.getByText("The last 30 minutes, without file or page names."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Send your activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(sentItems()).toEqual(["chat", "actions", "diagnostics"]);
    });
  });

  it("leaves out what the person did in the app unless they switch it on", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(sentItems()).toEqual(["chat", "diagnostics"]);
    });
  });

  it("sends the open chat unless the person switches it off", async () => {
    await open();
    const chat = screen.getByRole("switch", {
      name: "Send the chat",
    });
    expect(chat.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(chat);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(sentItems()).toEqual(["diagnostics"]);
    });
  });

  it("attaches the captures it opened with", async () => {
    // A response of the test's own, since jsdom's File reads only jsdom's
    // own Blob and a real Response hands back another kind.
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          blob: () => Promise.resolve(new Blob([png], { type: "image/png" })),
          ok: true,
        }),
      ),
    );
    renderWithDefaultStore(<ReportDialog />);
    act(() => {
      getDefaultStore().set(
        reportDialogAtom,
        feedbackReport({
          captures: [{ name: "capture-1.png", stamp: 1 }],
          surface: "capture",
        }),
      );
    });
    await screen.findByRole("button", { name: "Remove capture-1.png" });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(
        vi
          .mocked(rpcClient.problems.sendFeedback.call)
          .mock.calls.at(-1)?.[0]
          .images?.map((image) => image.name),
      ).toEqual(["capture-1.png"]);
    });
    vi.unstubAllGlobals();
  });

  it("shows what the person did a line each, with its switch at the foot", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "View Your activity" }));
    expect(screen.getByRole("heading", { name: "Your activity" })).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: "Send with your feedback" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getByRole("switch", { name: "Send your activity" }),
    ).toHaveProperty("ariaChecked", "true");
  });
});

describe("the feedback draft", () => {
  beforeEach(() => {
    getDefaultStore().set(feedbackDraftAtom, null);
  });

  const typeNote = (words: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "Your note" }), {
      target: { value: words },
    });
  };

  it("comes back as it was left when feedback is asked for again", async () => {
    await open();
    typeNote("The list jumps to the top.");
    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    const store = getDefaultStore();
    expect(store.get(reportDialogAtom)).toBeNull();
    expect(store.get(feedbackBarAtom)?.note).toBe("The list jumps to the top.");

    act(() => {
      openReportDialog(feedbackReport({ surface: "rail" }));
    });
    expect(store.get(reportDialogAtom)).toMatchObject({ surface: "test" });
    expect(store.get(feedbackBarAtom)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveProperty(
      "value",
      "The list jumps to the top.",
    );
    expect(
      screen.getByRole("button", { name: "Bug" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("goes on Cancel, so feedback asked for next starts fresh", async () => {
    await open();
    typeNote("Too slow to open.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const store = getDefaultStore();
    expect(store.get(feedbackBarAtom)).toBeNull();

    act(() => {
      openReportDialog(feedbackReport({ surface: "rail" }));
    });
    expect(store.get(reportDialogAtom)).toMatchObject({ surface: "rail" });
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveProperty(
      "value",
      "",
    );
  });

  const chatA = ChatIdSchema.parse("chat-a");
  const chatB = ChatIdSchema.parse("chat-b");

  it("takes in what another opening about the same chat brings", async () => {
    renderWithDefaultStore(<ReportDialog />);
    act(() => {
      openReportDialog(feedbackReport({ chatId: chatA, surface: "rail" }));
    });
    await screen.findByRole("button", { name: "View Diagnostics" });
    typeNote("It stopped halfway.");
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

    const onSent = vi.fn();
    act(() => {
      openReportDialog(
        feedbackReport({
          chatId: chatA,
          onSent,
          surface: "agent-offer",
          tag: "bug",
          writeup: { text: "The tab crashed.", title: "Tab crashed" },
        }),
      );
    });
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveProperty(
      "value",
      "It stopped halfway.",
    );
    expect(
      screen.getByRole("button", { name: "View Instrument's write-up" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Bug" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(getDefaultStore().get(feedbackDraftAtom)?.onSent).toEqual([onSent]);
  });

  it("asks before starting feedback about another chat", async () => {
    renderWithDefaultStore(<ReportDialog />);
    act(() => {
      openReportDialog(feedbackReport({ chatId: chatA, surface: "rail" }));
    });
    await screen.findByRole("button", { name: "View Diagnostics" });
    typeNote("About the first chat.");
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

    act(() => {
      openReportDialog(
        feedbackReport({
          chatId: chatB,
          surface: "model-error",
          writeup: { text: "Details.", title: "Model error" },
        }),
      );
    });
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveProperty(
      "value",
      "About the first chat.",
    );
    expect(
      screen.queryByRole("button", { name: "View Instrument's write-up" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start new" }));
    expect(getDefaultStore().get(reportDialogAtom)).toMatchObject({
      chatId: chatB,
      surface: "model-error",
    });
    await screen.findByRole("button", { name: "View Instrument's write-up" });
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveProperty(
      "value",
      "",
    );
  });
});
