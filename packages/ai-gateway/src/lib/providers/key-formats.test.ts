import { type AIProviderType } from "@instrument-org/shared";
import { findSecrets } from "@instrument-org/shared/secrets";
import { expect, it } from "vitest";

import { getAllProviderMetadata } from "./metadata";

/**
 * A key of each shape a provider's `keyFormat` names, put together here so no
 * whole key is written in the source. A provider added with a `keyFormat` and
 * no sample fails the first test, which is the reminder to teach the secret
 * rules its keys.
 */
const tail = (length: number) =>
  Array.from({ length }, (_, index) => "a1B2c3D4e5"[index % 10]).join("");
const SAMPLES: Partial<Record<AIProviderType, string>> = {
  anthropic: `sk-ant-api03-${tail(93)}AA`,
  cerebras: `csk-${tail(48).toLowerCase()}`,
  deepseek: `sk-${tail(32).toLowerCase()}`,
  fireworks: `fw_${tail(24)}`,
  google: `AIza${tail(35)}`,
  groq: `gsk_${tail(52)}`,
  minimax: `sk-api-${tail(80)}`,
  openai: `sk-proj-${tail(74)}T3BlbkFJ${tail(74)}`,
  openrouter: `sk-or-v1-${tail(64).toLowerCase()}`,
  vercel: `vck_${tail(40)}`,
  "x-ai": `xai-${tail(80)}`,
};

const withKeyFormat = getAllProviderMetadata().flatMap((metadata) =>
  metadata.api?.keyFormat ? [metadata] : [],
);

it("has a sample key for every provider that names a key format", () => {
  expect(
    withKeyFormat
      .filter((metadata) => SAMPLES[metadata.type] === undefined)
      .map((metadata) => metadata.type),
  ).toEqual([]);
});

it.each(withKeyFormat.map((metadata) => [metadata.type, metadata] as const))(
  "finds a %s key as a secret",
  (type, metadata) => {
    const sample = SAMPLES[type] ?? "";
    expect(sample.startsWith(metadata.api?.keyFormat ?? "")).toBe(true);
    expect(findSecrets(`KEY=${sample}\n`)).toHaveLength(1);
  },
);
