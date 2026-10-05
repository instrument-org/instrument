import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGuestNavigation } from "./use-guest-navigation";

const { useGuest } = vi.hoisted(() => ({ useGuest: vi.fn() }));

vi.mock("@/client/hooks/use-browser-targets", () => ({ useGuest }));

const TASK_ID = TaskIdSchema.parse("guest-navigation-test");
const FIRST = encodeBrowserTargetId(TASK_ID, StoreId.newSessionId());
const SECOND = encodeBrowserTargetId(TASK_ID, StoreId.newSessionId());

/** A stand-in guest handle whose history the test moves by hand. */
function fakeGuest(url: string, targetId: BrowserTargetId = FIRST) {
  const events = new EventTarget();
  const guest = {
    back: false,
    canGoBack: () => guest.back,
    canGoForward: () => guest.forward,
    emit: (event: string) => {
      events.dispatchEvent(new Event(event));
    },
    forward: false,
    on: (event: string, listener: () => void) => {
      events.addEventListener(event, listener);
      return () => {
        events.removeEventListener(event, listener);
      };
    },
    targetId,
    url: () => guest.page,
    page: url,
  };
  return guest;
}

beforeEach(() => {
  useGuest.mockReset();
});

describe("useGuestNavigation", () => {
  it("reads the guest on mount and again on each navigation", () => {
    const guest = fakeGuest("https://a.test/");
    useGuest.mockReturnValue(guest);
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useGuestNavigation(FIRST, { onNavigate }),
    );
    expect(result.current).toMatchInlineSnapshot(`
      {
        "canGoBack": false,
        "canGoForward": false,
        "url": "https://a.test/",
      }
    `);

    guest.page = "https://b.test/";
    guest.back = true;
    act(() => {
      guest.emit("did-navigate");
    });
    expect(result.current).toMatchInlineSnapshot(`
      {
        "canGoBack": true,
        "canGoForward": false,
        "url": "https://b.test/",
      }
    `);
    expect(onNavigate.mock.calls).toEqual([
      ["https://a.test/"],
      ["https://b.test/"],
    ]);
  });

  it("refreshes the steps, not the address, when a load fails", () => {
    const guest = fakeGuest("https://a.test/");
    useGuest.mockReturnValue(guest);
    const { result } = renderHook(() => useGuestNavigation(FIRST));

    guest.page = "chrome-error://chromewebdata/";
    guest.back = true;
    act(() => {
      guest.emit("did-fail-load");
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.url).toBe("https://a.test/");
  });

  it("stays unknown until its guest is ready", () => {
    const guest = fakeGuest("https://a.test/");
    useGuest.mockReturnValue(null);
    const { rerender, result } = renderHook(() => useGuestNavigation(FIRST));
    expect(result.current.url).toBeNull();

    useGuest.mockReturnValue(guest);
    rerender();
    expect(result.current.url).toBe("https://a.test/");
  });

  it("drops the previous guest's answer when the target changes or goes away", () => {
    const first = fakeGuest("https://a.test/");
    first.back = true;
    // The second target's guest is not ready yet.
    useGuest.mockImplementation((target) => (target === FIRST ? first : null));
    const initialProps: { target: BrowserTargetId | null } = { target: FIRST };
    const seen: (null | string)[] = [];
    const { rerender, result } = renderHook(
      ({ target }) => {
        const navigation = useGuestNavigation(target);
        seen.push(navigation.url);
        return navigation;
      },
      { initialProps },
    );
    expect(result.current.canGoBack).toBe(true);

    seen.length = 0;
    rerender({ target: SECOND });
    // Not even the render before the effect swaps guests shows the old page.
    expect(seen).not.toContain("https://a.test/");
    expect(result.current).toEqual({
      canGoBack: false,
      canGoForward: false,
      url: null,
    });

    // The first guest's listeners are gone with it.
    act(() => {
      first.emit("did-navigate");
    });
    expect(result.current.url).toBeNull();

    rerender({ target: FIRST });
    expect(result.current.url).toBe("https://a.test/");
    rerender({ target: null });
    expect(result.current.url).toBeNull();
  });
});
