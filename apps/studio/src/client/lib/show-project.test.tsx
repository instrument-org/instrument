import { projectDetailsModalAtom } from "@/client/atoms/project-details-modal";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { showProject } from "./show-project";

const { list, toast } = vi.hoisted(() => ({
  list: vi.fn<
    () => Promise<{ id: string; name: string; retired?: boolean }[]>
  >(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: { workspace: { projects: { list: { call: list } } } },
}));
vi.mock("@/client/lib/toast", () => ({ toast }));

afterEach(() => {
  getDefaultStore().set(projectDetailsModalAtom, null);
  list.mockReset();
  toast.mockReset();
  toast.error.mockReset();
});

describe("showProject", () => {
  it.each([
    ["its id", "prj_01JDAILY"],
    ["its name", "daily"],
  ])("opens a project's details by %s", async (_case, name) => {
    list.mockResolvedValue([{ id: "prj_01JDAILY", name: "Daily" }]);
    await showProject(name);
    expect(getDefaultStore().get(projectDetailsModalAtom)).toEqual({
      projectId: "prj_01JDAILY",
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("says so for a project that isn't there", async () => {
    list.mockResolvedValue([
      { id: "prj_01JDAILY", name: "Daily", retired: true },
    ]);
    await showProject("prj_01JDAILY");
    expect(getDefaultStore().get(projectDetailsModalAtom)).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      "No project at that address",
      expect.anything(),
    );
  });
});
