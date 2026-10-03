import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGuestNavigation } from "./use-guest-navigation";

const { getWebviewElement } = vi.hoisted(() => ({
  getWebviewElement: vi.fn(),
}));

vi.mock("@/client/lib/browser-pool", () => ({ getWebviewElement }));

const TASK_ID = TaskIdSchema.parse("guest-navigation-test");
const FIRST = encodeBrowserTargetId(TASK_ID, StoreId.newSessionId());
const SECOND = encodeBrowserTargetId(TASK_ID, StoreId.newSessionId());

/** A stand-in guest whose history the test moves by hand. */
function fakeGuest(url: string) {
  const guest = Object.assign(new EventTarget(), {
    attached: true,
    back: false,
    forward: false,
    url,
    canGoBack() {
      if (!guest.attached) {
        throw new Error("not attached");
      }
      return guest.back;
    },
    canGoForward() {
      return guest.forward;
    },
    getURL() {
      if (!guest.attached) {
        throw new Error("not attached");
      }
      return guest.url;
    },
  });
  return guest;
}

beforeEach(() => {
  getWebviewElement.mockReset();
});

describe("useGuestNavigation", () => {
  it("reads the guest on mount and again on each navigation", () => {
    const guest = fakeGuest("https://a.test/");
    getWebviewElement.mockReturnValue(guest);
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

    guest.url = "https://b.test/";
    guest.back = true;
    act(() => {
      guest.dispatchEvent(new Event("did-navigate"));
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
    getWebviewElement.mockReturnValue(guest);
    const { result } = renderHook(() => useGuestNavigation(FIRST));

    guest.url = "chrome-error://chromewebdata/";
    guest.back = true;
    act(() => {
      guest.dispatchEvent(new Event("did-fail-load"));
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.url).toBe("https://a.test/");
  });

  it("stays unknown until an unattached guest navigates", () => {
    const guest = fakeGuest("about:blank");
    guest.attached = false;
    getWebviewElement.mockReturnValue(guest);
    const { result } = renderHook(() => useGuestNavigation(FIRST));
    expect(result.current.url).toBeNull();

    guest.attached = true;
    guest.url = "https://a.test/";
    act(() => {
      guest.dispatchEvent(new Event("did-navigate-in-page"));
    });
    expect(result.current.url).toBe("https://a.test/");
  });

  it("drops the previous guest's answer when the target changes or goes away", () => {
    const first = fakeGuest("https://a.test/");
    first.back = true;
    const second = fakeGuest("about:blank");
    second.attached = false;
    getWebviewElement.mockImplementation((target) =>
      target === FIRST ? first : second,
    );
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
      first.dispatchEvent(new Event("did-navigate"));
    });
    expect(result.current.url).toBeNull();

    rerender({ target: FIRST });
    expect(result.current.url).toBe("https://a.test/");
    rerender({ target: null });
    expect(result.current.url).toBeNull();
  });
});
