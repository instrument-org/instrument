import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canStealFocus, createFocusGuard } from "./focus-guard";

const TASK_ID = TaskIdSchema.parse("focus-guard-test");
const TARGET_ID = encodeBrowserTargetId(TASK_ID, StoreId.newSessionId());

const COMMAND_TAIL_MS = 500;

describe("canStealFocus", () => {
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
    expect(canStealFocus(method)).toBe(expected);
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

  it("bounces guest focus while a command is in flight and the host claimed focus", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    expect(restoreHostFocus).toHaveBeenCalledWith(TARGET_ID);
  });

  it("does not bounce when the host never claimed focus", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, false);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
    expect(restoreHostFocus).not.toHaveBeenCalled();
  });

  it("claimHost after an unfocused arm enables bouncing (renderer focusin correction)", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, false);
    guard.claimHost();
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
  });

  it("releaseHost stops bouncing (user takeover recorded)", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true);
    guard.releaseHost();
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("settle restores host focus when claimed, not otherwise", () => {
    const guard = makeGuard();
    const settle = guard.armCommand(TARGET_ID, true);
    settle();
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);

    restoreHostFocus.mockClear();
    guard.releaseHost();
    guard.armCommand(TARGET_ID, false)();
    expect(restoreHostFocus).not.toHaveBeenCalled();
  });

  it("keeps the guard through the tail, then expires it", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true)();
    vi.advanceTimersByTime(COMMAND_TAIL_MS - 1);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("an overlapping command's guard survives the first settle's tail", () => {
    const guard = makeGuard();
    const settleFirst = guard.armCommand(TARGET_ID, true);
    const settleSecond = guard.armCommand(TARGET_ID, true);
    settleFirst();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    settleSecond();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("navigation guard holds past the command tail until the load settles", () => {
    const guard = makeGuard();
    const settle = guard.armCommand(TARGET_ID, true);
    guard.onNavigationStart(TARGET_ID);
    settle();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(true);
    guard.onLoadSettled(TARGET_ID);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("ignores a navigation that starts without an active command guard", () => {
    const guard = makeGuard();
    guard.claimHost();
    guard.onNavigationStart(TARGET_ID);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });

  it("load progress restores host focus only while navigation-guarded and claimed", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true);
    guard.onLoadProgress(TARGET_ID);
    expect(restoreHostFocus).not.toHaveBeenCalled();

    guard.onNavigationStart(TARGET_ID);
    guard.onLoadProgress(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);

    guard.releaseHost();
    guard.onLoadProgress(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("guest WebContents focus is bounced while any guard holds", () => {
    const guard = makeGuard();
    guard.armCommand(TARGET_ID, true);
    guard.onGuestFocus(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);

    guard.releaseHost();
    guard.onGuestFocus(TARGET_ID);
    expect(restoreHostFocus).toHaveBeenCalledTimes(1);
  });

  it("forgetTarget clears both guards and a later settle cannot revive them", () => {
    const guard = makeGuard();
    const settle = guard.armCommand(TARGET_ID, true);
    guard.onNavigationStart(TARGET_ID);
    guard.forgetTarget(TARGET_ID);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
    settle();
    vi.advanceTimersByTime(COMMAND_TAIL_MS);
    expect(guard.bounceGuestFocus(TARGET_ID)).toBe(false);
  });
});
