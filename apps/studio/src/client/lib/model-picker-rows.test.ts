import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  connectionsOf,
  makerName,
  type PickerRow,
  rowsForConnection,
  rowsForSearch,
} from "./model-picker-rows";

type Spec = {
  author?: string;
  canonicalId: string;
  name: string;
  replacedBy?: string;
  restricted?: string;
  tags?: string[];
};

const connection =
  (
    config: string,
    provider: "anthropic" | "chatgpt" | "instrument" | "openrouter",
    providerName: string,
    defaultAuthor: string,
  ) =>
  ({
    author = defaultAuthor,
    canonicalId,
    name,
    replacedBy,
    restricted,
    tags = [],
  }: Spec) => {
    const params = {
      provider,
      providerConfigId: AIProviderConfigIdSchema.parse(config),
    };
    return AIGatewayModel.Schema.parse({
      author,
      canonicalId,
      features: [],
      name,
      params,
      providerId:
        canonicalId === "auto"
          ? OUR_MODELS.text.id
          : `${author}/${canonicalId}`,
      providerName,
      tags,
      ...(replacedBy && { replacedBy }),
      ...(restricted && {
        restricted: { message: restricted, reason: "plan" },
      }),
      uri: AIGatewayModelURI.fromModel({
        author,
        canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
        params,
      }),
    });
  };

const instrument = connection(
  "instrument",
  "instrument",
  "Instrument",
  OUR_MODELS.author,
);
const anthropic = connection(
  "anthropic-key",
  "anthropic",
  "Anthropic",
  "anthropic",
);
const chatgptWork = connection(
  "chatgpt-a",
  "chatgpt",
  "me@example.com",
  "openai",
);
const chatgptHome = connection(
  "chatgpt-b",
  "chatgpt",
  "me@example.com (2)",
  "openai",
);
const openrouter = connection(
  "openrouter-key",
  "openrouter",
  "OpenRouter",
  "openai",
);

const autoOnly = [instrument({ canonicalId: "auto", name: "Auto" })];

const anthropicList = [
  anthropic({ canonicalId: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" }),
  anthropic({
    canonicalId: "claude-opus-5.5",
    name: "Claude Opus 5.5",
    restricted: "Needs a paid plan.",
  }),
  anthropic({ canonicalId: "claude-haiku-4.5", name: "Claude Haiku 4.5" }),
  anthropic({
    canonicalId: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    replacedBy: "claude-sonnet-5.5",
  }),
  anthropic({
    canonicalId: "claude-3-opus",
    name: "Claude 3 Opus",
    tags: ["legacy"],
  }),
];

const longCatalog = [
  openrouter({
    author: "anthropic",
    canonicalId: "claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    tags: ["recommended"],
  }),
  openrouter({
    author: "google",
    canonicalId: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    tags: ["recommended"],
  }),
  openrouter({
    author: "moonshotai",
    canonicalId: "kimi-k3",
    name: "Kimi K3",
    tags: ["recommended"],
  }),
  ...Array.from({ length: 30 }, (_, index) =>
    openrouter({
      author: "meta-llama",
      canonicalId: `llama-filler-${index}`,
      name: `Llama Filler ${index}`,
    }),
  ),
];

const describeRows = (rows: PickerRow[]) =>
  rows.map((row) =>
    row.type === "header"
      ? `# ${row.label}`
      : row.type === "auto"
        ? "[Auto card]"
        : `${row.showMaker ? `(${row.model.author}) ` : ""}${row.model.name}${row.sub ? ` — ${row.sub}` : ""}`,
  );

describe("connectionsOf", () => {
  it("lists each connection once, Instrument first, two plans apart", () => {
    expect(
      connectionsOf([
        ...anthropicList,
        chatgptWork({ canonicalId: "gpt-5.5", name: "GPT-5.5" }),
        chatgptHome({ canonicalId: "gpt-5.5", name: "GPT-5.5" }),
        ...autoOnly,
      ]).map((entry) => `${entry.name} (${entry.provider})`),
    ).toMatchInlineSnapshot(`
      [
        "Instrument (instrument)",
        "Anthropic (anthropic)",
        "me@example.com (chatgpt)",
        "me@example.com (2) (chatgpt)",
      ]
    `);
  });
});

describe("rowsForConnection", () => {
  it("lays out each kind of list", () => {
    const cases: [string, AIGatewayModel.Type[], string][] = [
      ["Instrument at launch: Auto alone", autoOnly, "instrument"],
      [
        "Instrument letting models through: Auto leads, mixed makers marked",
        [
          ...autoOnly,
          instrument({
            author: "anthropic",
            canonicalId: "claude-sonnet-5.5",
            name: "Claude Sonnet 5.5",
          }),
          instrument({
            author: "google",
            canonicalId: "gemini-3.7-flash",
            name: "Gemini 3.7 Flash",
          }),
        ],
        "instrument",
      ],
      [
        "one maker: latest, older, then what needs a plan",
        anthropicList,
        "anthropic-key",
      ],
      [
        "a long catalog opens on its recommendations, by maker",
        longCatalog,
        "openrouter-key",
      ],
    ];
    expect(
      Object.fromEntries(
        cases.map(([name, models, connectionId]) => [
          name,
          describeRows(
            rowsForConnection({ connectionId, models, showAll: false }),
          ),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "Instrument at launch: Auto alone": [
          "[Auto card]",
        ],
        "Instrument letting models through: Auto leads, mixed makers marked": [
          "[Auto card]",
          "# Or pick one yourself",
          "(anthropic) Claude Sonnet 5.5",
          "(google) Gemini 3.7 Flash",
        ],
        "a long catalog opens on its recommendations, by maker": [
          "# Anthropic",
          "(anthropic) Claude Sonnet 5.5",
          "# Google",
          "(google) Gemini 3.7 Flash",
          "# Moonshot",
          "(moonshotai) Kimi K3",
        ],
        "one maker: latest, older, then what needs a plan": [
          "# Latest",
          "Claude Haiku 4.5",
          "Claude Sonnet 5.5",
          "# Older versions",
          "Claude 3 Opus",
          "Claude Sonnet 5 — Replaced by Claude Sonnet 5.5",
          "# Requires a paid plan",
          "Claude Opus 5.5 — Needs a paid plan.",
        ],
      }
    `);
  });

  it("shows the whole of a long catalog when asked", () => {
    const rows = rowsForConnection({
      connectionId: "openrouter-key",
      models: longCatalog,
      showAll: true,
    });
    expect(rows.filter((row) => row.type === "model")).toHaveLength(
      longCatalog.length,
    );
  });
});

describe("rowsForSearch", () => {
  it("groups matches under every connection that serves them", () => {
    expect(
      describeRows(
        rowsForSearch({
          models: [...autoOnly, ...anthropicList, ...longCatalog],
          query: "sonnet",
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "# Anthropic",
        "Claude Sonnet 5 — Replaced by Claude Sonnet 5.5",
        "Claude Sonnet 5.5",
        "# OpenRouter",
        "(anthropic) Claude Sonnet 5.5",
      ]
    `);
  });
});

describe("makerName", () => {
  it.each([
    ["moonshotai", "Moonshot"],
    ["some-new-lab", "Some New Lab"],
  ])("%s reads as %s", (author, name) => {
    expect(makerName(author)).toBe(name);
  });
});
