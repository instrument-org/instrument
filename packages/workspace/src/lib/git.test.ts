import { describe, expect, it } from "vitest";

import { gitSubprocessEnv } from "./git";

describe("gitSubprocessEnv", () => {
  it("carries core.longpaths to a bare git the shell command does not wrap", () => {
    const env = gitSubprocessEnv();

    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.longpaths");
    expect(env.GIT_CONFIG_VALUE_0).toBe("true");
  });

  it("outranks the GIT_CONFIG_* pairs the agent exported", () => {
    const env = gitSubprocessEnv({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_0: "Someone Else",
      GIT_CONFIG_VALUE_1: "store",
    });

    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.longpaths");
    expect(env.GIT_CONFIG_VALUE_0).toBe("true");
    // Unreachable at COUNT=1 either way, but left unset rather than relied on.
    expect(env.GIT_CONFIG_KEY_1).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_1).toBeUndefined();
  });
});
