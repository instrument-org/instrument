import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stage } from "./stage";

const REPLY =
  "The billing screens match the October run, and two of them changed.";

beforeEach(() => {
  // The clock only asks for frames; the tests step it by hand.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the reply shows right now. */
const shown = (stage: Stage, text = REPLY) =>
  text.slice(0, stage.cutOf("reply"));

describe("Stage", () => {
  it("shows a reply already there when first seen, whole", () => {
    const stage = new Stage();
    stage.setTarget("reply", REPLY, false);
    expect(shown(stage)).toBe(REPLY);
    expect(stage.isRevealing("reply")).toBe(false);
  });

  it("paces words arriving after the reply is on screen", () => {
    const stage = new Stage();
    stage.setTarget("reply", "The", true);
    stage.setTarget("reply", REPLY, true);
    // What was there when it was first seen stays out.
    expect(shown(stage)).toBe("The");
    stage.step(100);
    const early = shown(stage);
    expect(early.length).toBeGreaterThan(3);
    expect(early.length).toBeLessThan(REPLY.length);
    expect(REPLY.startsWith(early)).toBe(true);
    stage.step(2000);
    expect(shown(stage)).toBe(REPLY.slice(0, REPLY.lastIndexOf(" ")));
  });

  it("finishes the reveal once the stream ends, and only then stops revealing", () => {
    const stage = new Stage();
    stage.setTarget("reply", "The", true);
    stage.setTarget("reply", REPLY, false);
    expect(stage.isRevealing("reply")).toBe(true);
    for (let at = 0; at < 60; at += 1) {
      stage.step(16);
    }
    expect(shown(stage)).toBe(REPLY);
    expect(stage.isRevealing("reply")).toBe(false);
  });

  it("tells its listeners when the stream's end draws the last word", async () => {
    const stage = new Stage();
    stage.setTarget("reply", "The", true);
    stage.setTarget("reply", REPLY, true);
    stage.step(2000);
    // Everything but the word still arriving is out.
    expect(shown(stage)).toBe(REPLY.slice(0, REPLY.lastIndexOf(" ")));
    await Promise.resolve();
    const heard = vi.fn();
    stage.subscribeReveal("reply", heard);
    // The stream ends during a render: the reply draws the last word in that
    // render, and the rows held behind it hear once the render is done.
    stage.setTarget("reply", REPLY, false);
    expect(shown(stage)).toBe(REPLY);
    expect(heard).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledOnce();
  });

  it("stands still while stopped, and moves only when stepped", () => {
    const stage = new Stage();
    stage.setRate(0);
    stage.setTarget("reply", "The", true);
    stage.setTarget("reply", REPLY, true);
    const before = shown(stage);
    stage.step(16);
    stage.step(16);
    expect(shown(stage).length).toBeGreaterThanOrEqual(before.length);
    expect(stage.now()).toBe(32);
  });

  it("starts again from what still matches when the text is rewritten", () => {
    const stage = new Stage();
    stage.setTarget("reply", "The", true);
    stage.setTarget("reply", "The billing screens match", true);
    stage.step(2000);
    stage.setTarget("reply", "The billing pages", true);
    expect(shown(stage, "The billing pages").trimEnd()).toBe("The billing");
  });

  it("tells a listener when the cut moves, and not when a render set it", () => {
    const stage = new Stage();
    const listener = vi.fn();
    stage.setTarget("reply", "The", true);
    stage.subscribeReveal("reply", listener);
    stage.setTarget("reply", REPLY, true);
    expect(listener).not.toHaveBeenCalled();
    stage.step(100);
    expect(listener).toHaveBeenCalled();
  });

  it("shows everything at once on catching up", () => {
    const stage = new Stage();
    stage.setTarget("reply", "The", true);
    stage.setTarget("reply", REPLY, false);
    stage.catchUp();
    expect(shown(stage)).toBe(REPLY);
  });

  it("holds a key for its time on the stage clock, and says when it lets go", () => {
    const stage = new Stage();
    const listener = vi.fn();
    stage.subscribeReveal("settle", listener);
    stage.hold("settle", 240);
    expect(stage.isHeld("settle")).toBe(true);
    stage.step(200);
    expect(stage.isHeld("settle")).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    stage.step(50);
    expect(stage.isHeld("settle")).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("starts a reply first seen waiting from nothing, and moves it only once it shows", () => {
    const stage = new Stage();
    stage.setTarget("reply", "The billing", true, true);
    expect(shown(stage)).toBe("");
    stage.step(500);
    expect(shown(stage)).toBe("");
    stage.setTarget("reply", REPLY, true);
    stage.step(100);
    expect(shown(stage).length).toBeGreaterThan(0);
    expect(shown(stage)).not.toBe(REPLY);
  });

  it("lets every hold go on catching up", () => {
    const stage = new Stage();
    stage.hold("settle", 240);
    stage.catchUp();
    expect(stage.isHeld("settle")).toBe(false);
  });
});
