import { ChatIdSchema } from "@instrument-org/workspace/client";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGesturesFor } from "./use-open-target";

const hostPaths = vi.fn(
  ({ filePaths }: { filePaths: string[] }): Record<string, null | string> =>
    Object.fromEntries(
      filePaths.map((filePath) => [
        filePath,
        filePath === "workspace:/Notes/plan.md"
          ? "/Users/sam/Instrument/Notes/plan.md"
          : null,
      ]),
    ),
);

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("@/client/lib/toast", () => ({ toast: { error: toastError } }));

// Nothing here opens a link.
vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => () => undefined,
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        files: {
          hostPaths: {
            call: (input: { filePaths: string[] }) =>
              Promise.resolve(hostPaths(input)),
          },
        },
      },
    },
  },
}));

const chatId = ChatIdSchema.parse("2026-10-19-copy-path");

afterEach(() => {
  hostPaths.mockClear();
  toastError.mockClear();
});

async function copied(
  target: Parameters<ReturnType<typeof useGesturesFor>>[0],
) {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const { result } = renderHook(() => useGesturesFor());
  const copy = result
    .current(target)
    .destinations.find((destination) => destination.id === "copy");
  copy?.run();
  await waitFor(() => {
    expect(writeText).toHaveBeenCalled();
  });
  return writeText.mock.calls[0];
}

describe("Copy Path", () => {
  // A chat keeps a file in the workspace by its place there, which no other
  // program can open; what is pasted is where it is on this computer.
  it("copies where a path a chat kept is on this computer", async () => {
    await expect(
      copied({ chatId, kind: "path", path: "workspace:/Notes/plan.md" }),
    ).resolves.toEqual(["/Users/sam/Instrument/Notes/plan.md"]);
  });

  it("copies the path as named when it names nothing the chat reaches", async () => {
    await expect(
      copied({ chatId, kind: "path", path: "attachments/gone.png" }),
    ).resolves.toEqual(["attachments/gone.png"]);
  });

  it("copies the path as named with no chat to read it against", async () => {
    await expect(copied({ kind: "path", path: "report.md" })).resolves.toEqual([
      "report.md",
    ]);
    expect(hostPaths).not.toHaveBeenCalled();
  });

  // Where a file in the workspace is depends on the workspace alone.
  it("copies where a file in the workspace is with no chat to read it against", async () => {
    await expect(
      copied({ kind: "path", path: "workspace:/Notes/plan.md" }),
    ).resolves.toEqual(["/Users/sam/Instrument/Notes/plan.md"]);
  });

  it("copies nothing for a file in the workspace that names nothing here", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useGesturesFor());
    result
      .current({ chatId, kind: "path", path: "workspace:/Gone/plan.md" })
      .destinations.find((destination) => destination.id === "copy")
      ?.run();
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});
