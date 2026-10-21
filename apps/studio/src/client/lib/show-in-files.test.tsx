// A skill's address names it the way a task loads it, and what opens is the
// folder the workspace has it in.
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { folderHref } from "@/shared/computer-href";
import { installWindowStubs } from "@/tests/window-stubs";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { showSkillFolder } from "./show-in-files";

const { list, toast } = vi.hoisted(() => ({
  list: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: { workspace: { skill: { list: { call: list } } } },
}));
vi.mock("@/client/lib/toast", () => ({
  toast: Object.assign(toast, { error: vi.fn() }),
}));

const SKILLS = [
  {
    aliases: ["agents:handoff"],
    path: "/Users/sam/.agents/skills/handoff",
    qualifiedName: "agents:handoff",
  },
  {
    aliases: ["workspace:handoff"],
    path: "/Users/sam/Instrument/Skills/handoff",
    qualifiedName: "handoff",
  },
];

/** The addresses of the window's tabs. */
function tabs() {
  return getDefaultStore()
    .get(appTabsAtom)
    .tabs.map((tab) => tab.pathname);
}

describe("showSkillFolder", () => {
  beforeEach(() => {
    installWindowStubs();
    Object.assign(window.api, { windowType: "app" });
    list.mockReset().mockResolvedValue(SKILLS);
    toast.mockReset();
    getDefaultStore().set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: null,
      tabs: [],
    });
  });

  it.each([
    [
      "a source's own id",
      "agents:handoff",
      "/Users/sam/.agents/skills/handoff",
    ],
    [
      "the name it is invoked by",
      "handoff",
      "/Users/sam/Instrument/Skills/handoff",
    ],
  ])("opens the folder of the skill named by %s", async (_case, name, path) => {
    await showSkillFolder(name);
    expect(tabs()).toEqual([folderHref(path)]);
  });

  it("says so when no skill has the name", async () => {
    await showSkillFolder("gone");
    expect(tabs()).toEqual([]);
    expect(toast).toHaveBeenCalledWith(
      "No skill by that name is installed on this computer.",
    );
  });
});
