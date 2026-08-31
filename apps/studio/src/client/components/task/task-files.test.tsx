import { renderWithProviders } from "@/tests/render";
import { type Task, TaskIdSchema } from "@instrument-org/workspace/client";
import { ORPCError } from "@orpc/client";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskFiles } from "./task-files";

const { queryOptions } = vi.hoisted(() => ({ queryOptions: vi.fn() }));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: { task: { files: { list: { queryOptions } } } },
  },
}));

const TASK: Task = {
  createdAt: new Date("2026-08-19T17:15:52Z"),
  id: TaskIdSchema.parse("a-task"),
  title: "A task",
  updatedAt: new Date("2026-08-19T17:15:52Z"),
};

function renderFailingWith(error: Error) {
  queryOptions.mockReturnValue({
    queryFn: () => Promise.reject(error),
    queryKey: ["task", "files", "list", TASK.id],
    retry: false,
  });

  return renderWithProviders(
    <TaskFiles
      activeFilePath={null}
      attachedFolders={undefined}
      onFileSelect={vi.fn()}
      task={TASK}
    />,
  );
}

// The list polls for as long as the panel is open, so a listing that cannot be
// made fails on every poll. Left as a skeleton it reads as a slow load, and the
// user waits on something that is not coming.
describe("TaskFiles", () => {
  it("says the files could not be read when the first listing fails", async () => {
    renderFailingWith(
      new ORPCError("FILE_SYSTEM_ERROR", {
        defined: true,
        message: "Error listing task files (EIO)",
      }),
    );

    expect(
      await screen.findByText("Couldn't read this task's files. Still trying."),
    ).toBeTruthy();
  });

  // Trashing an open task asks once more for files that are gone. Nothing is
  // wrong and nothing is coming, so the panel says so rather than promising a
  // retry it has no reason to make.
  it("says a task's files are gone when its directory is", async () => {
    renderFailingWith(
      new ORPCError("NOT_FOUND", {
        defined: true,
        message: "No directory for task",
      }),
    );

    expect(
      await screen.findByText("This task's files are no longer on disk."),
    ).toBeTruthy();
  });
});
