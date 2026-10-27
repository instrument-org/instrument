import { beforeEach, describe, expect, it, vi } from "vitest";

const { claude, me, token } = vi.hoisted(() => ({
  claude: { email: "sam@claude.example", kind: "signed-in" },
  me: {
    cached: undefined as undefined | { email: string; name: string },
    fails: false,
    fetched: { email: "sam@instrument.example", name: "Sam Rivera" },
  },
  token: { value: true },
}));

vi.mock("@/electron-main/lib/chatgpt-account", () => ({
  chatGPTAccountPeople: () => [{ email: "sam@chatgpt.example", name: "Sam" }],
  chatGPTAccountUser: () => undefined,
}));
vi.mock("@/electron-main/lib/grok-account", () => ({
  grokAccountPeople: () => [{ email: "sam@grok.example" }],
}));
vi.mock("@/electron-main/lib/claude-account", () => ({
  claudeAccountStatus: () => claude,
  claudeAccountStatusKnown: () => Promise.resolve(),
}));
vi.mock("@/electron-main/platform-api/utils", () => ({
  hasToken: () => token.value,
}));
vi.mock("@/electron-main/platform-api/client", () => ({
  platformApiQueryClient: {
    fetchQuery: () => {
      if (me.fails) {
        return Promise.reject(new Error("offline"));
      }
      me.cached = me.fetched;
      return Promise.resolve(me.fetched);
    },
    getQueryData: () => me.cached,
  },
  platformApiRpcClient: {
    users: {
      getMe: { queryKey: () => ["me"], queryOptions: () => ({}) },
    },
  },
}));

const { knownSignedInPeople, signedInPeople } =
  await import("./get-signed-in-user");

describe("signed-in people", () => {
  beforeEach(() => {
    me.cached = undefined;
    me.fails = false;
    token.value = true;
  });

  it("names every provider account known without asking, the Instrument one only once fetched", () => {
    expect(knownSignedInPeople()).toEqual([
      { email: "sam@chatgpt.example", name: "Sam" },
      { email: "sam@grok.example" },
      { email: "sam@claude.example" },
    ]);
  });

  it("asks who the Instrument account is before answering", async () => {
    const { people, unknownAccount } = await signedInPeople();

    expect(people[0]).toEqual({
      email: "sam@instrument.example",
      name: "Sam Rivera",
    });
    expect(unknownAccount).toBe(false);
  });

  it("says the account is unknown when asking fails while signed in", async () => {
    me.fails = true;
    expect((await signedInPeople()).unknownAccount).toBe(true);

    token.value = false;
    expect((await signedInPeople()).unknownAccount).toBe(false);
  });
});
