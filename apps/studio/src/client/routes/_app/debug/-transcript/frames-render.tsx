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
import { vi } from "vitest";

import { buildFrames, type Frame } from "./frames";
import { scenarios } from "./scenarios";

/**
 * How many test files split the library between them.
 *
 * Drawing every frame is around fifteen seconds of work, and Vitest's unit of
 * parallelism is the file: as one test it is the last thing still running long
 * after the rest of the project is done. Each shard file takes one slice, and
 * the slices are taken by position so a scenario added to the library lands in
 * one of them without anybody choosing which.
 */
export const SHARD_COUNT = 3;

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

/** What one shard's sweep found, for its test file to hold to the rules. */
export interface SweepReport {
  /** Where each rule was broken, named by scenario and frame. */
  broke: Record<"empty" | "indented" | "live", string[]>;
  /** How many frames were drawn, so an empty sweep cannot pass vacuously. */
  drawn: number;
  /** How many scenarios the shard covered, for the same reason. */
  scenarioCount: number;
}

/**
 * Every frame of a shard's scenarios, drawn.
 *
 * The transcript page exists to be watched, and this is the part of watching it
 * that a machine can do: scrub the library and check the things that have to
 * hold in every single frame. Anything about how it looks is still a job for
 * the page.
 *
 * One pass, three checks. Drawing is the expensive part -- some hundreds of
 * transcripts, the longest of them a page of markdown -- so it happens once and
 * every rule reads the same render.
 */
export function drawEveryFrame(shard: number): SweepReport {
  const shardScenarios = scenarios.filter(
    (_, index) => index % SHARD_COUNT === shard,
  );
  const broke: SweepReport["broke"] = { empty: [], indented: [], live: [] };
  let drawn = 0;

  for (const scenario of shardScenarios) {
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
      // indented at all: it belongs to no phase. A group that has been opened
      // -- by the reader, or by a step that opens itself -- is drawing its
      // rows on purpose and is not what this is looking for.
      const indented = [
        ...container.querySelectorAll('[data-expanded="false"] .pl-6'),
      ];
      if (indented.length > 1) {
        broke.indented.push(
          `${at}: ${indented.map((node) => node.textContent).join(" | ")}`,
        );
      }

      cleanup();
    }
  }

  return { broke, drawn, scenarioCount: shardScenarios.length };
}

function draw(frame: Frame) {
  const { container } = renderWithProviders(
    <RouterContextProvider router={router}>
      {/* The ban on a second TooltipProvider describes the running app, which
          has one at its root. This mounts a component without that shell and so
          has to supply it, the same as the test files this draws for. */}
      {/* eslint-disable-next-line no-restricted-syntax */}
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
