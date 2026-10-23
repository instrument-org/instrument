import { describe, expect, it } from "vitest";

import { findSecrets, redactSecrets, redactUrlQueries } from "./secrets";

/**
 * A run of letters and digits that is the same on every run. Secrets in this
 * file are put together from it, so no whole token is written in the source
 * for a scanner to flag.
 */
function run(length: number, alphabet = "aB3dE5gH7jK9mN1pQ2sT4vW6xY8z") {
  return Array.from(
    { length },
    (_, index) => alphabet[(index * 7 + 3) % alphabet.length],
  ).join("");
}

const HEX = "0123456789abcdef";

describe("redactSecrets", () => {
  it.each([
    ["OpenAI key", `sk-proj-${run(74)}T3BlbkFJ${run(74)}`],
    ["Anthropic key", `sk-ant-api03-${run(93)}AA`],
    ["Anthropic key", `sk-ant-oat01-${run(95)}`],
    ["Groq key", `gsk_${run(52)}`],
    ["Hugging Face token", `hf_${run(34, "abcdefghijklmnopqrstuvwxyzABC")}`],
    ["Linear key", `lin_api_${run(40)}`],
    ["Notion token", `ntn_${run(11, "0123456789")}${run(35)}`],
    ["Stripe key", `sk_live_${run(30)}`],
    ["GitHub token", `ghp_${run(36)}`],
    ["GitHub token", `github_pat_${run(82)}`],
    ["GitLab token", `glpat-${run(24)}`],
    ["Slack token", `xoxb-${run(11, "0123456789")}-${run(24)}`],
    ["npm token", `npm_${run(36)}`],
    ["AWS access key", `AKIA${run(16, "ABCDEFGHJKLMNPQRSTUVWXYZ234567")}`],
    ["Databricks token", `dapi${run(32, HEX)}`],
    ["Figma token", `figd_${run(44)}`],
  ])("finds a %s", (label, secret) => {
    expect(redactSecrets(`TOKEN=${secret}\nDEBUG=true`)).toBe(
      `TOKEN=[secret: ${label}]\nDEBUG=true`,
    );
  });

  it("keeps the name in an assignment and takes the value", () => {
    expect(
      redactSecrets(`password: "${run(20)}"\nGOOGLE_MAPS_KEY=AIza${run(35)}\n`),
    ).toMatchInlineSnapshot(`
      "password: "[secret: credential]"
      GOOGLE_MAPS_KEY=[secret: Google API key]
      "
    `);
  });

  it("takes a bearer token and a JWT", () => {
    expect(
      redactSecrets(
        `Authorization: Bearer ey${run(20)}.ey${run(20)}.${run(30)}`,
      ),
    ).toMatchInlineSnapshot(`"Authorization: Bearer [secret: JWT]"`);
  });

  it("takes only the password from an address with credentials", () => {
    expect(
      redactSecrets(
        `postgres://app_user:${run(12)}@db.example.com:5432/prod https://${run(8)}:${run(40)}@github.com/org/repo.git`,
      ),
    ).toMatchInlineSnapshot(`"postgres://app_user:[secret: password]@db.example.com:5432/prod https://dK2xdK2x:[secret: password]@github.com/org/repo.git"`);
  });

  it("leaves a template's placeholder password", () => {
    const text =
      "postgres://user:${DB_PASSWORD}@localhost/db mysql://root:password@localhost";
    expect(redactSecrets(text)).toBe(text);
  });

  it("takes a private key block whole", () => {
    const block = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      run(70),
      run(70),
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");
    expect(redactSecrets(`key:\n${block}\ndone`)).toBe(
      "key:\n[secret: private key]\ndone",
    );
  });

  it.each([
    "inputTokens: inputTokens.value",
    "const apiKey = getApiKey(providerConfigId);",
    'access: MountedFolder.Access; key: "disable-model-invocation"',
    "sk-spinner-wave-rect-element is a CSS class",
    "The user's token count went past 120,000 tokens.",
  ])("leaves ordinary code and prose alone: %s", (text) => {
    expect(findSecrets(text)).toEqual([]);
  });
});

describe("redactUrlQueries", () => {
  it("drops a query and a fragment and keeps the address", () => {
    expect(
      redactUrlQueries(
        "Failed to load URL: https://sync.example.com/api/v1/start?gdpr=0&global_user_id=0f93d1df, then https://example.com/callback#access_token=abc and https://example.com/plain.",
      ),
    ).toMatchInlineSnapshot(`"Failed to load URL: https://sync.example.com/api/v1/start?[query], then https://example.com/callback?[query] and https://example.com/plain."`);
  });
});
