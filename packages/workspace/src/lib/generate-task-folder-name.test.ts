import { beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../schemas/paths";
import {
  generateBranchFolderName,
  generateTaskFolderName,
} from "./generate-task-folder-name";
import { getCurrentDate } from "./get-current-date";
import { pathExists } from "./path-exists";

vi.mock("./path-exists", () => ({ pathExists: vi.fn() }));
vi.mock("./get-current-date", () => ({ getCurrentDate: vi.fn() }));

const tasksDir = AbsolutePathSchema.parse("/tmp/tasks");

beforeEach(() => {
  // Local-time constructor so the formatted prefix is timezone-independent
  // (formatDatePrefix uses local getFullYear/getMonth/getDate).
  vi.mocked(getCurrentDate).mockReturnValue(new Date(2026, 5, 23, 12, 0, 0));
  vi.mocked(pathExists).mockResolvedValue(false);
});

describe("generateTaskFolderName", () => {
  it("prefixes the date and appends the prompt slug", async () => {
    const name = await generateTaskFolderName({
      prompt: "Add a dark mode toggle",
      tasksDir,
    });
    expect(name).toBe("2026-06-23-add-a-dark-mode-toggle");
  });

  it("falls back to `task` when the prompt has no usable slug", async () => {
    const name = await generateTaskFolderName({ prompt: "🚀🔥", tasksDir });
    expect(name).toBe("2026-06-23-task");
  });

  it("falls back to `task` when no prompt is provided", async () => {
    const name = await generateTaskFolderName({ tasksDir });
    expect(name).toBe("2026-06-23-task");
  });

  it("appends a numeric suffix on collision", async () => {
    vi.mocked(pathExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const name = await generateTaskFolderName({ prompt: "Fix bug", tasksDir });
    expect(name).toBe("2026-06-23-fix-bug-3");
  });

  it("always produces a valid subdomain within 63 chars", async () => {
    const name = await generateTaskFolderName({
      prompt: "a".repeat(200),
      tasksDir,
    });
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("generateBranchFolderName", () => {
  it("appends -2 when the source base is taken", async () => {
    vi.mocked(pathExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const result = await generateBranchFolderName({
      sourceFolderName: "2026-06-23-add-toggle",
      tasksDir,
    });
    expect(result).toEqual({ name: "2026-06-23-add-toggle-2", suffix: 2 });
  });

  it("bumps an existing trailing integer instead of nesting", async () => {
    vi.mocked(pathExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const result = await generateBranchFolderName({
      sourceFolderName: "2026-06-23-add-toggle-2",
      tasksDir,
    });
    expect(result).toEqual({ name: "2026-06-23-add-toggle-3", suffix: 3 });
  });

  it("reuses the clean base when it is free", async () => {
    const result = await generateBranchFolderName({
      sourceFolderName: "2026-06-23-add-toggle-2",
      tasksDir,
    });
    expect(result).toEqual({ name: "2026-06-23-add-toggle", suffix: 1 });
  });
});
