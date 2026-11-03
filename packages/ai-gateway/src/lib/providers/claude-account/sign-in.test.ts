import { describe, expect, it, vi } from "vitest";

import {
  splitPastedCode,
  startClaudeCodeSignIn,
  UnusableCodeError,
} from "./sign-in";

/** What the fake Claude Code process answers, set per case. */
const claude = vi.hoisted(() => ({
  callback: (): Promise<unknown> => Promise.resolve(),
  completion: (): Promise<unknown> => Promise.resolve(),
}));

vi.mock(import("./session"), () => ({
  ClaudeCodeSession: class {
    close() {}
    control(name: string) {
      switch (name) {
        case "claudeAuthenticate": {
          return Promise.resolve({
            automaticUrl: "https://claude.ai/oauth?state=auto",
            manualUrl: "https://claude.ai/oauth?state=manual",
          });
        }
        case "claudeOAuthCallback": {
          return claude.callback();
        }
        default: {
          return claude.completion();
        }
      }
    }
  } as never,
}));

describe("splitPastedCode", () => {
  it.each([
    ["abc123#state-1", null, { code: "abc123", state: "state-1" }],
    ["  abc123#state-1\n", null, { code: "abc123", state: "state-1" }],
    ["abc123", "from-link", { code: "abc123", state: "from-link" }],
    ["abc123#from-link", "from-link", { code: "abc123", state: "from-link" }],
    // A state the app never issued is Anthropic's to define, so it passes.
    ["abc123#unknown", "from-link", { code: "abc123", state: "unknown" }],
  ])("reads %j", (pasted, stateOfLink, expected) => {
    expect(
      splitPastedCode(pasted, stateOfLink, new Set(["earlier-link"])),
    ).toEqual(expected);
  });

  it.each([
    ["", "from-link"],
    ["#state-1", null],
    ["abc123", null],
    ["abc123#earlier-link", "from-link"],
  ])("refuses %j", (pasted, stateOfLink) => {
    expect(() =>
      splitPastedCode(pasted, stateOfLink, new Set(["earlier-link"])),
    ).toThrow(UnusableCodeError);
  });
});

describe("submitCode", () => {
  // A code that works finishes the sign-in, which closes the session, and
  // the callback that carried the code can reject after that. The card then
  // flashed "Claude didn't accept that code" over a sign-in that worked
  // (7a52807bf).
  it.each([
    { finished: true, outcome: "resolves" },
    { finished: false, outcome: "rejects" },
  ])(
    "$outcome when the callback fails and the sign-in finished: $finished",
    async ({ finished }) => {
      claude.completion = () =>
        finished ? Promise.resolve() : new Promise(() => {});
      claude.callback = () => Promise.reject(new Error("session closed"));
      const signIn = await startClaudeCodeSignIn({
        configDir: undefined,
        executablePath: "/claude",
      });
      if (finished) {
        await signIn.completion;
        await expect(signIn.submitCode("abc123")).resolves.toBeUndefined();
      } else {
        await expect(signIn.submitCode("abc123")).rejects.toThrow(
          "session closed",
        );
      }
    },
  );
});
