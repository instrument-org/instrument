import { ChatTextIcon } from "@phosphor-icons/react/ChatText";
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_COMMAND_ALIASES,
  matchComposerCommands,
} from "./app-commands";
import {
  bytesGoing,
  formatSize,
  partState,
  toggleItem,
  togglePart,
} from "./feedback-selection";

const IDS = ["chat", "t1", "settings"];

describe("feedback selection", () => {
  it.each([
    [[], true],
    [["t1"], "indeterminate"],
    [["chat", "settings"], "indeterminate"],
    [IDS, false],
  ])("reads a part with %j left out as %j", (leftOut, state) => {
    expect(partState(IDS, new Set(leftOut))).toBe(state);
  });

  it("takes a part that is all in all out, and brings a partial one all back", () => {
    const out = togglePart(IDS, new Set());
    expect([...out].toSorted()).toEqual(["chat", "settings", "t1"]);

    expect([...togglePart(IDS, new Set(["t1"]))]).toEqual([]);
    expect([...togglePart(IDS, out)]).toEqual([]);
  });

  it("keeps another part's items as they were", () => {
    const leftOut = togglePart(IDS, new Set(["log"]));
    expect(leftOut.has("log")).toBe(true);
    expect(partState(["log"], togglePart(IDS, leftOut))).toBe(false);
  });

  it("toggles one item", () => {
    expect([...toggleItem("t1", new Set())]).toEqual(["t1"]);
    expect([...toggleItem("t1", new Set(["t1"]))]).toEqual([]);
  });

  it("counts only what still goes", () => {
    const items = [
      { bytes: 100, id: "chat" },
      { bytes: 50, id: "t1" },
    ];
    expect(bytesGoing(items, new Set(["t1"]))).toBe(100);
  });

  it.each([
    [0, "1 KB"],
    [61 * 1024, "61 KB"],
    [1500 * 1024, "1.5 MB"],
  ])("shows %d bytes as %s", (bytes, shown) => {
    expect(formatSize(bytes)).toBe(shown);
  });
});

describe("app commands", () => {
  const feedback = {
    aliases: FEEDBACK_COMMAND_ALIASES,
    description: "Send feedback",
    icon: ChatTextIcon,
    id: "feedback",
    onSelect: () => undefined,
  };

  it.each([
    ["", "feedback"],
    ["feed", "feedback"],
    ["Bu", "bug"],
    ["rep", "report"],
    ["budget", undefined],
  ])("answers /%s with /%s", (query, name) => {
    expect(matchComposerCommands([feedback], query)[0]?.name).toBe(name);
  });
});
