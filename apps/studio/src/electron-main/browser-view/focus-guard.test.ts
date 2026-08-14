import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bouncesGuestFocus,
  createFocusGuard,
  isAgentDrivenCommand,
} from "./focus-guard";

const TASK_ID = TaskIdSchema.parse("focus-guard-test");
const TARGET_ID = encodeBrowserTargetId(TASK_ID, StoreId.newSessionId());

const COMMAND_TAIL_MS = 500;

describe("isAgentDrivenCommand", () => {
  it.each([
    ["Input.dispatchKeyEvent", true],
    ["Input.dispatchMouseEvent", true],
    ["Input.insertText", true],
    ["Input.synthesizeTapGesture", true],
    ["DOM.focus", true],
    ["Page.bringToFront", true],
    ["Page.navigate", true],
    ["Page.navigateToHistoryEntry", true],
    ["Page.reload", true],
    ["Accessibility.getFullAXTree", false],
    ["Network.enable", false],
    ["Page.captureScreenshot", false],
    ["Page.enable", false],
    ["Page.screencastFrameAck", false],
    ["Page.startScreencast", false],
    ["Runtime.evaluate", false],
  ])("%s -> %s", (method, expected) => {
    expect(isAgentDrivenCommand(method)).toBe(expected);
  });
});

describe("bouncesGuestFocus", () => {
  // Input is the exclusion that matters: keyboard input only reaches a guest
  // that holds focus, so rejecting the focus a CDP click grants would send the
  // agent's next keystroke into the host renderer.
  it.each([
    ["DOM.focus", true],
    ["Page.bringToFront", true],
    ["Page.navigate", true],
    ["Page.navigateToHistoryEntry", true],
    ["Page.reload", true],
    ["Input.dispatchKeyEvent", false],
    ["Input.dispatchMouseEvent", false],
    ["Input.insertText", false],
    ["Runtime.evaluate", false],
  ])("%s -> %s", (method, expected) => {
    expect(bouncesGuestFocus(method)).toBe(expected);
  });
});

describe("createFocusGuard", () => {
  const restoreHostFocus = vi.fn();

  function makeGuard() {
    return createFocusGuard({ restoreHostFocus });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    restoreHostFocus.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounces guest focus while a bouncing command is in flight and the host claimed focus", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, true);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    expect(restoreHostFocus).toHaveBeenCalledWith(TARGET_ID);
  });

  it("leaves guest focus alone while an input command is in flight", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, false);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
    expect(guard.isGuarded(TARGET_ID)).toBe(true);
    expect(restoreHostFocus).not.toHaveBeenCalled();
  });

  it("does not bounce when the host never claimed focus", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, false, true);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
    expect(restoreHostFocus).not.toHaveBeenCalled();
  });

  it("claimHost after an unfocused arm enables bouncing (renderer focusin correction)", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, false, true);
    guard.claimHost();
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
  });

  it("releaseHost stops bouncing (user takeover recorded)", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, true);
    guard.releaseHost();
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("a bouncing command restores host focus as soon as it settles", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, true)();
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("an input command restores host focus only once the target goes quiet", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, false)();
    expect(restoreHostFocus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("a burst of input commands does not hand the caret back mid-burst", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, false)();
    vi.advanceTimersByTime(COMMAND_TAIL_MS - 1);
    const settleNext = guard.armCommand(TARGET_ID, true, false);
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(restoreHostFocus).not.toHaveBeenCalled();

    settleNext();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("does not restore on quiet when the host never claimed focus", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, false, false)();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(restoreHostFocus).not.toHaveBeenCalled();
  });

  it("keeps the bounce guard through the tail, then expires it", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, true)();
    vi.advanceTimersByTime(COMMAND_TAIL_MS - 1);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("an overlapping command's guard survives the first settle's tail", () => {
    const guard = makeGuard();
    const settleFirst = guard.armCommand(TARGET_ID, true, true);
    const settleSecond = guard.armCommand(TARGET_ID, true, true);
    settleFirst();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    settleSecond();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("an input command overlapping a bouncing one does not cancel the bounce", () => {
    const guard = makeGuard();
    const settleNavigate = guard.armCommand(TARGET_ID, true, true);
    const settleInput = guard.armCommand(TARGET_ID, true, false);
    settleInput();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    settleNavigate();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("navigation guard holds past the command tail until the load settles", () => {
    const guard = makeGuard();
    const settle = guard.armCommand(TARGET_ID, true, true);
    guard.onNavigationStart(TARGET_ID);
    settle();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    guard.onLoadSettled(TARGET_ID);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("a click that navigates still guards the load it started", () => {
    const guard = makeGuard();
    const settle = guard.armCommand(TARGET_ID, true, false);
    guard.onNavigationStart(TARGET_ID);
    settle();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
  });

  it("ignores a navigation that starts without an active command guard", () => {
    const guard = makeGuard();
    guard.claimHost();
    guard.onNavigationStart(TARGET_ID);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("load progress restores host focus only while navigation-guarded and claimed", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, true);
    guard.onLoadProgress(TARGET_ID);
    expect(restoreHostFocus).not.toHaveBeenCalled();

    guard.onNavigationStart(TARGET_ID);
    guard.onLoadProgress(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);

    guard.releaseHost();
    guard.onLoadProgress(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("guest WebContents focus is bounced while a bouncing guard holds, not an input one", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true, false);
    guard.onGuestFocus(TARGET_ID);
    expect(restoreHostFocus).not.toHaveBeenCalled();

    guard.armCommand(TARGET_ID, true, true);
    guard.onGuestFocus(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);

    guard.releaseHost();
    guard.onGuestFocus(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("forgetTarget clears every guard and a later settle cannot revive them", () => {
    const guard = makeGuard();
    const settle = guard.armCommand(TARGET_ID, true, true);
    guard.onNavigationStart(TARGET_ID);
    guard.forgetTarget(TARGET_ID);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
    settle();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });
});
