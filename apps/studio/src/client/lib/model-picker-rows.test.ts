import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  connectionsOf,
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
    provider: "anthropic" | "chatgpt-account" | "instrument" | "openrouter",
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
  "chatgpt-account",
  "me@example.com",
  "openai",
);
const chatgptHome = connection(
  "chatgpt-b",
  "chatgpt-account",
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
  rows.map((row) => {
    switch (row.type) {
      case "auto": {
        return "[Auto]";
      }
      case "header": {
        return `# ${row.label}`;
      }
      case "model": {
        return `(${row.model.author}) ${row.model.name}${row.sub ? ` — ${row.sub}` : ""}`;
      }
      case "show-all": {
        return "[Show all models]";
      }
      case "show-fewer": {
        return "[Show fewer]";
      }
    }
  });

/** A short catalog mixing makers, some recommended, as Workers AI lists. */
const workersAI = connection("workers-ai", "openrouter", "Workers AI", "z-ai");
const shortMixed = [
  workersAI({
    canonicalId: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    tags: ["recommended"],
  }),
  workersAI({
    author: "deepseek",
    canonicalId: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    tags: ["recommended"],
  }),
  workersAI({ canonicalId: "glm-5.2", name: "GLM 5.2", replacedBy: "glm-5.3" }),
  workersAI({ canonicalId: "glm-5.3", name: "GLM 5.3", tags: ["recommended"] }),
  workersAI({
    author: "meta",
    canonicalId: "llama-4-scout",
    name: "Llama 4 Scout",
  }),
];

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
        "me@example.com (chatgpt-account)",
        "me@example.com (2) (chatgpt-account)",
      ]
    `);
  });
});

describe("rowsForConnection", () => {
  it("lays out each kind of list", () => {
    const cases: [string, AIGatewayModel.Type[], string, boolean?][] = [
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
      ["a short mixed list folds too", shortMixed, "workers-ai"],
      ["the same list shown whole", shortMixed, "workers-ai", true],
    ];
    expect(
      Object.fromEntries(
        cases.map(([name, models, connectionId, showAll = false]) => [
          name,
          describeRows(rowsForConnection({ connectionId, models, showAll })),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "Instrument at launch: Auto alone": [
          "[Auto]",
        ],
        "Instrument letting models through: Auto leads, mixed makers marked": [
          "[Auto]",
          "(anthropic) Claude Sonnet 5.5",
          "(google) Gemini 3.7 Flash",
        ],
        "a long catalog opens on its recommendations, by maker": [
          "# Recommended",
          "(anthropic) Claude Sonnet 5.5",
          "(google) Gemini 3.7 Flash",
          "(moonshotai) Kimi K3",
          "[Show all models]",
        ],
        "a short mixed list folds too": [
          "# Recommended",
          "(deepseek) DeepSeek V4 Flash",
          "(z-ai) GLM 5.3",
          "(z-ai) GLM 5.3 Flash",
          "[Show all models]",
        ],
        "one maker: latest, older, then what needs a plan": [
          "# Latest",
          "(anthropic) Claude Haiku 4.5",
          "(anthropic) Claude Sonnet 5.5",
          "# Older versions",
          "(anthropic) Claude 3 Opus",
          "(anthropic) Claude Sonnet 5 — Replaced by Claude Sonnet 5.5",
          "# Requires a paid plan",
          "(anthropic) Claude Opus 5.5 — Needs a paid plan.",
        ],
        "the same list shown whole": [
          "# Recommended",
          "(deepseek) DeepSeek V4 Flash",
          "(z-ai) GLM 5.3",
          "(z-ai) GLM 5.3 Flash",
          "# Other models",
          "(meta) Llama 4 Scout",
          "# Older versions",
          "(z-ai) GLM 5.2 — Replaced by GLM 5.3",
          "[Show fewer]",
        ],
      }
    `);
  });

  // Showing all used to re-sort the list, so the rows already on screen
  // jumped under the pointer; it may only add below them.
  it.each([
    ["a long catalog", longCatalog, "openrouter-key"],
    ["a short mixed list", shortMixed, "workers-ai"],
  ])(
    "showing all of %s keeps every folded row where it was",
    (_, models, connectionId) => {
      const folded = rowsForConnection({
        connectionId,
        models,
        showAll: false,
      });
      const whole = rowsForConnection({ connectionId, models, showAll: true });
      expect(whole.slice(0, folded.length - 1)).toEqual(folded.slice(0, -1));
    },
  );

  it("leads the recommendations with the provider's default", () => {
    const models = shortMixed.map((model) =>
      model.canonicalId === "glm-5.3-flash"
        ? { ...model, tags: [...model.tags, "default" as const] }
        : model,
    );
    const rows = rowsForConnection({
      connectionId: "workers-ai",
      models,
      showAll: false,
    });
    expect(describeRows(rows).slice(0, 3)).toEqual([
      "# Recommended",
      "(z-ai) GLM 5.3 Flash",
      "(deepseek) DeepSeek V4 Flash",
    ]);
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
        "(anthropic) Claude Sonnet 5 — Replaced by Claude Sonnet 5.5",
        "(anthropic) Claude Sonnet 5.5",
        "# OpenRouter",
        "(anthropic) Claude Sonnet 5.5",
      ]
    `);
  });
});
