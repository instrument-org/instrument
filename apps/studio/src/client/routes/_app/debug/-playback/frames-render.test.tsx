import { ChatStream } from "@/client/components/chat-stream";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { renderWithProviders } from "@/tests/render";
import { type Task, TaskIdSchema } from "@instrument-org/workspace/client";
import { cleanup } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildFrames, type Frame } from "./frames";
import { scenarios } from "./scenarios";

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("transcript-playback"),
  title: "Transcript playback",
  updatedAt: new Date(0),
};

function draw(frame: Frame) {
  const { container } = renderWithProviders(
    <TooltipProvider>
      <ChatStream
        isAgentRunning={frame.isAgentRunning}
        isDeveloperMode={false}
        messages={frame.messages}
        onContinue={vi.fn()}
        onModelChange={vi.fn()}
        onRetry={vi.fn()}
        onStartNewTask={vi.fn()}
        task={task}
      />
    </TooltipProvider>,
  );
  return container;
}

/**
 * Every frame of every scenario, drawn.
 *
 * The playback page exists to be watched, and this is the part of watching it
 * that a machine can do: scrub the whole library and check the things that have
 * to hold in every single frame. Anything about how it looks is still a job for
 * the page.
 */
describe("the playback library, drawn frame by frame", () => {
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
        // second indented step means the fold has let something out. Only the
        // copy of the step in flight is allowed. Prose is not a step: a
        // paragraph the agent wrote mid-phase indents with the phase and holds
        // its place, so it is excluded here rather than counted against it.
        const indented = [...container.querySelectorAll(".pl-6")].filter(
          (node) => node.querySelector(".prose") === null,
        );
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
  }, 30_000);
});
