import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { studioModalAtom } from "./studio-modal";

describe("studioModalAtom", () => {
  it("reads null until opened", () => {
    const store = createStore();
    const settings = studioModalAtom<{ tab: string }>();
    expect(store.get(settings)).toBeNull();
  });

  it("opens with the written state and closes on null", () => {
    const store = createStore();
    const settings = studioModalAtom<{ tab: string }>();

    store.set(settings, { tab: "General" });
    expect(store.get(settings)).toEqual({ tab: "General" });

    store.set(settings, null);
    expect(store.get(settings)).toBeNull();
  });

  it("replaces an open modal instead of stacking", () => {
    const store = createStore();
    const settings = studioModalAtom<{ tab: string }>();
    const login = studioModalAtom<{ reason: string }>();

    store.set(settings, { tab: "Providers" });
    store.set(login, { reason: "provider-required" });

    expect(store.get(settings)).toBeNull();
    expect(store.get(login)).toEqual({ reason: "provider-required" });
  });

  it("ignores a close from a modal that was already replaced", () => {
    const store = createStore();
    const settings = studioModalAtom<{ tab: string }>();
    const login = studioModalAtom<{ reason: string }>();

    store.set(settings, { tab: "Providers" });
    store.set(login, { reason: "provider-required" });
    // Settings' dialog closes as it's replaced; its onOpenChange(false)
    // writes null, which must not tear down the login modal.
    store.set(settings, null);

    expect(store.get(login)).toEqual({ reason: "provider-required" });
  });

  it("updates state in place while open", () => {
    const store = createStore();
    const settings = studioModalAtom<{ tab: string }>();

    store.set(settings, { tab: "General" });
    store.set(settings, { tab: "Providers" });

    expect(store.get(settings)).toEqual({ tab: "Providers" });
  });
});
