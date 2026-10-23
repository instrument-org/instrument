import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatStatusLine } from "./chat-status-line";

const CHAT_ID = ChatIdSchema.parse("2026-10-05-lisbon-trip");

vi.mock("./child-tasks-query", () => ({
  useChatTasks: () => ({ data: [] }),
}));

// The card's steps are the transcript's, which this does not draw.
vi.mock("./child-tasks", () => ({ ChildTranscript: () => null }));

/** The jobs the chat left running in the test running. */
const jobs = vi.hoisted(() => ({ running: [] as unknown[] }));

vi.mock("@/client/hooks/use-task-background-processes", () => ({
  useTaskBackgroundProcesses: () => jobs.running,
}));

const { stopAllJobs } = vi.hoisted(() => ({ stopAllJobs: vi.fn() }));

vi.mock("@/client/hooks/use-stop-background-process", () => ({
  useStopBackgroundProcess: () => ({
    busy: false,
    stop: vi.fn(),
    stopAll: stopAllJobs,
  }),
}));

// The command's highlighting reads the theme, which is beside the point here.
vi.mock("@/client/components/message-part/bash-command-section", () => ({
  BashCommandPreview: ({ command }: { command: string }) => (
    <code>{command}</code>
  ),
}));

const JOB = (id: string, explanation: string) => ({
  command: `npx serve -l 4173 ${id}`,
  explanation,
  id,
  sessionId: "ses_chat",
  startedAt: new Date(Date.now() - 90_000),
});

const { stopSessions } = vi.hoisted(() => ({
  stopSessions:
    vi.fn<(input: { id: string; sessionId?: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        session: {
          queryOptions: () => ({
            queryFn: () => ({ sessionId: undefined }),
            queryKey: ["chat-session"],
          }),
        },
      },
      session: {
        stop: { mutationOptions: () => ({ mutationFn: stopSessions }) },
      },
    },
  },
}));

beforeEach(() => {
  jobs.running = [];
  stopAllJobs.mockReset();
  stopSessions.mockReset();
  stopSessions.mockResolvedValue(undefined);
});

const chat = (state: "idle" | "working") => ({
  id: CHAT_ID,
  lastUserMessageAt: 1,
  latest: { at: 2, kind: "step" as const, text: "Reading the fares" },
  lastStep: { at: 2, text: "Reading the fares" },
  ownWorking: state === "working",
  runningTasks: [],
  state,
  title: "Lisbon trip",
});

describe("ChatStatusLine", () => {
  it("stops the whole chat from the dot while it works", async () => {
    await renderInBrowser(
      <ChatStatusLine chat={chat("working")} onOpenTask={vi.fn()} />,
    );
    await expect.element(page.getByText("Reading the fares")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Stop" }));
    await expect
      .poll(() => stopSessions.mock.calls[0]?.[0])
      .toEqual({ id: CHAT_ID });
  });

  it("offers no stop once the chat's work is done", async () => {
    await renderInBrowser(
      <ChatStatusLine chat={chat("idle")} onOpenTask={vi.fn()} />,
    );
    await expect.element(page.getByText("Done")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Stop" }))
      .not.toBeInTheDocument();
  });

  it("says how many commands are still running once the work is done", async () => {
    jobs.running = [
      JOB("bg_1", "Serving the comparison page"),
      JOB("bg_2", "Checking Intercom's pricing every hour"),
    ];
    await renderInBrowser(
      <ChatStatusLine chat={chat("idle")} onOpenTask={vi.fn()} />,
    );
    await expect.element(page.getByText("Done")).toBeVisible();
    await expect.element(page.getByText("2 commands running")).toBeVisible();
    await userEvent.click(page.getByText("2 commands running"));
    await expect
      .element(page.getByText("Serving the comparison page"))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Stop all" }));
    expect(stopAllJobs).toHaveBeenCalledOnce();
  });

  it("leaves the line to the work while the chat works", async () => {
    jobs.running = [JOB("bg_1", "Serving the comparison page")];
    await renderInBrowser(
      <ChatStatusLine chat={chat("working")} onOpenTask={vi.fn()} />,
    );
    await expect.element(page.getByText("Reading the fares")).toBeVisible();
    await expect
      .element(page.getByText("1 command running"))
      .not.toBeInTheDocument();
  });
});
