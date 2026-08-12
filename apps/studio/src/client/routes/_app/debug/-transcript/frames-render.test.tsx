import { ChatStream } from "@/client/components/chat-stream";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { renderWithProviders } from "@/tests/render";
import { type Task, TaskIdSchema } from "@instrument-org/workspace/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { cleanup } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildFrames, type Frame } from "./frames";
import { scenarios } from "./scenarios";

// A diagram asks the app which theme to draw against, and the real provider
// resolves that through `matchMedia` and an RPC round trip -- neither of which
// exists here, and neither of which any rule below reads.
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
    theme: "light",
  }),
}));

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("debug-transcript"),
  title: "Transcript",
  updatedAt: new Date(0),
};

/**
 * A router, and only a router.
 *
 * Several cards a transcript can carry read the location or link somewhere, and
 * the hooks they use dereference the router context rather than checking it, so
 * without one they throw rather than degrade. Nothing here navigates, so the
 * tree is empty and the context is provided on its own: rendering matches would
 * mean mounting the app around every frame.
 */
const router = createRouter({
  history: createMemoryHistory({ initialEntries: ["/"] }),
  routeTree: createRootRoute(),
});

function draw(frame: Frame) {
  const { container } = renderWithProviders(
    <RouterContextProvider router={router}>
      <TooltipProvider>
        <ChatStream
          isAgentRunning={frame.isAgentRunning}
          isDeveloperMode={false}
          messages={frame.messages}
          onContinue={vi.fn()}
          onModelChange={vi.fn()}
          onRetry={vi.fn()}
          onRunAgain={vi.fn()}
          onStartNewTask={vi.fn()}
          task={task}
        />
      </TooltipProvider>
    </RouterContextProvider>,
  );
  return container;
}

/**
 * Every frame of every scenario, drawn.
 *
 * The transcript page exists to be watched, and this is the part of watching it
 * that a machine can do: scrub the whole library and check the things that have
 * to hold in every single frame. Anything about how it looks is still a job for
 * the page.
 */
describe("the scenario library, drawn frame by frame", () => {
  // One pass, three checks. Drawing the library is the expensive part -- some
  // hundreds of transcripts, the longest of them a page of markdown -- so it
  // happens once and every rule reads the same render.
  it("holds every rule in every frame", () => {
    const broke: Record<"empty" | "indented" | "live", string[]> = {
      empty: [],
      indented: [],
      live: [],
    };
    let drawn = 0;

    for (const scenario of scenarios) {
      for (const [index, frame] of buildFrames(scenario.script).entries()) {
        const at = `${scenario.name} #${(index + 1).toString()} (${frame.mark.kind} ${frame.mark.phase ?? ""})`;
        const container = draw(frame);
        drawn++;

        // One thing runs at a time, so one thing on screen says so. More than
        // one is the transcript claiming the agent is in two places at once,
        // which is what the head-line rule exists to prevent.
        const live = [...container.querySelectorAll(".brand-shiny-text")];
        if (live.length > 1) {
          broke.live.push(
            `${at}: ${live.map((node) => node.textContent).join(" | ")}`,
          );
        }

        // A group box with nothing in it still takes up the transcript's
        // rhythm, so it reads as a gap where the folded steps used to be.
        if (
          [...container.querySelectorAll(".-my-1")].some(
            (box) => box.childElementCount === 0,
          )
        ) {
          broke.empty.push(at);
        }

        // While a group is folded its steps cost one line between them, so a
        // second indented row means the fold has let something out. Only the
        // copy of the step in flight is allowed, and a paragraph is never
        // indented at all: it belongs to no phase.
        const indented = [...container.querySelectorAll(".pl-6")];
        if (indented.length > 1) {
          broke.indented.push(
            `${at}: ${indented.map((node) => node.textContent).join(" | ")}`,
          );
        }

        cleanup();
      }
    }

    expect(drawn).toBeGreaterThan(200);
    expect(broke).toEqual({ empty: [], indented: [], live: [] });
  }, 120_000);
});
