// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
// turn end, regenerating: apps/studio/src/client/components/settings/*, apps/studio/src/electron-main/menus/*, apps/studio/src/shared/*, packages/workspace/src/**/*.ts with instrument://, packages/workspace/system-skills/instrument-guide/*
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { settingsTargetOf } from "@/client/components/settings/settings-index";
import { instrumentLinkOf } from "@instrument-org/shared";
import { isScreenName } from "@/shared/instrument-screens";

import { productGuideReference } from "./product-guide";

// The menu bar is built as the main process builds it on a Mac, with the
// little of Electron it touches while building stood in for.
vi.mock("electron", () => ({
  app: { getName: () => "Instrument" },
  BrowserWindow: { getFocusedWindow: () => null },
  Menu: { getApplicationMenu: () => null },
  nativeImage: { createMenuSymbol: () => ({}) },
  shell: {},
}));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  getWorkspacePreferences: () => ({ get: () => undefined }),
  isDeveloperMode: () => false,
  showsBookmarksBar: () => true,
  toggleBookmarksBar: () => undefined,
}));
// What its items do, none of which building the menu runs.
vi.mock("@/electron-main/app-command", () => ({ runAppCommand: () => {} }));
vi.mock("@/electron-main/lib/open-external", () => ({}));
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: {} }));
vi.mock("@/electron-main/stores/workspace/window-state", () => ({}));
vi.mock("@/electron-main/lib/setup-state", () => ({ isSetupUp: () => false }));
// Loading the agent takes longer than this test may, and picks programs by the
// platform it loads on, so the menus reach it only for its types.
vi.mock("@instrument-org/workspace/electron", () => {
  throw new Error(
    "The menu bar's modules load @instrument-org/workspace/electron. Import what they need from a module that does not.",
  );
});

async function macMenuBar() {
  const platform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    const { createAppWindowMenu } =
      await import("@/electron-main/menus/app-window");
    return createAppWindowMenu({
      canMerge: true,
      canReopenClosed: true,
      mergeAll: () => {},
      openNew: () => {},
      openNewWithChat: () => {},
      reopenClosed: () => {},
    });
  } finally {
    Object.defineProperty(process, "platform", { value: platform });
  }
}

const GUIDE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/workspace/system-skills/instrument-guide",
);
const WORKSPACE_DIR = path.resolve(GUIDE_DIR, "../..");

describe("the product guide skill", () => {
  it("carries the reference as the app has it, so a new setting reaches the agent with the change that adds it", async () => {
    await expect(
      productGuideReference({ menus: await macMenuBar() }),
    ).toMatchFileSnapshot(path.join(GUIDE_DIR, "reference.md"));
  });

  it("links only settings and screens the app has", () => {
    const text = fs.readFileSync(path.join(GUIDE_DIR, "SKILL.md"), "utf8");
    const links = [...text.matchAll(/\]\((instrument:\/\/[^)\s]+)\)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(links.length).toBeGreaterThan(0);
    expect(brokenLinks(links)).toEqual([]);
  });
});

describe("the workspace's own text", () => {
  // Errors and notes the agent relays link the setting that fixes them, so a
  // renamed row would otherwise leave a chip that opens a search.
  it("links only settings and screens the app has", () => {
    const links = fs
      .globSync("src/**/*.ts", { cwd: WORKSPACE_DIR })
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(WORKSPACE_DIR, file), "utf8");
        return [
          ...text.matchAll(/instrument:\/\/(?:settings|screen)\/[\w:-]+/g),
        ].map((match) => match[0]);
      });
    expect(links.length).toBeGreaterThan(0);
    expect(brokenLinks(links)).toEqual([]);
  });
});

function brokenLinks(links: string[]): string[] {
  return links.filter((url) => {
    const link = instrumentLinkOf(url);
    if (link?.kind === "settings") {
      return settingsTargetOf(link.name).kind === "search";
    }
    if (link?.kind === "screen") {
      return !isScreenName(link.name);
    }
    return true;
  });
}
