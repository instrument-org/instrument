import { ChatIdSchema } from "@instrument-org/workspace/electron";
import { call, os } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { grokAccount } from "./grok-account";

const mocks = vi.hoisted(() => ({
  appChanged: vi.fn(() => Promise.resolve()),
  grokPlanSignedInHere: vi.fn(() => Promise.resolve(undefined)),
  signInWithGrok: vi.fn(),
  waitInChat: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/electron-main/rpc/base", () => ({
  base: os.errors({ API_ERROR: {}, NOT_FOUND: {}, UNAUTHORIZED: {} }),
}));
vi.mock("@/electron-main/lib/grok-account", () => ({
  cancelGrokSignIn: vi.fn(),
  checkGrokSubscriptions: vi.fn(),
  grokAccountsStatus: vi.fn(),
  signInWithGrok: mocks.signInWithGrok,
  signOutOfGrok: vi.fn(),
}));
vi.mock("@/electron-main/stores/workspace/provider-configs", () => ({
  setProviderConfigEnabled: vi.fn(),
}));
vi.mock(
  import("@instrument-org/workspace/electron"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    appChanged: mocks.appChanged,
    grokPlanSignedInHere: mocks.grokPlanSignedInHere,
    waitInChat: mocks.waitInChat,
  }),
);

// Nothing of the context is read on these paths.
const options = { context: {} as unknown as InitialRPCContext };

const account = (state: "no-subscription" | "signed-in") => ({
  id: "g1",
  label: "sam@example.com",
  state,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("grokAccount.signIn", () => {
  it("tells X a plan is in once an account that can search signs in", async () => {
    mocks.signInWithGrok.mockResolvedValue({
      account: account("signed-in"),
      outcome: "signed-in",
    });

    await call(grokAccount.signIn, { opensIn: "app" }, options);

    expect(mocks.signInWithGrok).toHaveBeenCalledWith({ opensIn: "app" });
    expect(mocks.grokPlanSignedInHere).toHaveBeenCalledOnce();
  });

  it("leaves X be for an account with no plan", async () => {
    mocks.signInWithGrok.mockResolvedValue({
      account: account("no-subscription"),
      outcome: "signed-in",
    });

    await call(grokAccount.signIn, { forApp: "x", opensIn: "app" }, options);

    expect(mocks.grokPlanSignedInHere).not.toHaveBeenCalled();
    expect(mocks.appChanged).not.toHaveBeenCalled();
  });

  it("turns down the plan row that asked when the sign-in is turned down on xAI's page", async () => {
    mocks.signInWithGrok.mockResolvedValue({ outcome: "declined" });

    await call(grokAccount.signIn, { forApp: "x", opensIn: "app" }, options);

    // The plan's, never the site's connection.
    expect(mocks.appChanged).toHaveBeenCalledWith("x", {
      event: "declined",
      plan: "grok",
    });
  });

  it("has the chat whose card the row is on wait on the plan again", async () => {
    mocks.signInWithGrok.mockResolvedValue({ outcome: "canceled" });

    await call(
      grokAccount.signIn,
      {
        chatId: ChatIdSchema.parse("2026-11-27-x"),
        forApp: "x",
        opensIn: "app",
      },
      options,
    );
    await call(grokAccount.signIn, { opensIn: "app" }, options);

    expect(mocks.waitInChat.mock.calls).toEqual([
      ["x", "2026-11-27-x", { plan: "grok" }],
    ]);
  });

  it("turns down nothing for a sign-in no row asked for, or one canceled", async () => {
    mocks.signInWithGrok.mockResolvedValue({ outcome: "declined" });
    await call(grokAccount.signIn, { opensIn: "external" }, options);
    mocks.signInWithGrok.mockResolvedValue({ outcome: "canceled" });
    await call(grokAccount.signIn, { forApp: "x", opensIn: "app" }, options);

    expect(mocks.appChanged).not.toHaveBeenCalled();
  });
});
