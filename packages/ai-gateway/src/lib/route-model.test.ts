import { type AIProviderType } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import {
  type ModelConnection,
  type ModelRouteTable,
  routeModel,
} from "./route-model";

const connection = (id: string, type: AIProviderType): ModelConnection => ({
  // Branded id; a bare string is fine for this test.
  id: id as ModelConnection["id"],
  type,
});

const uriOf = (canonicalId: string, type: AIProviderType, configId: string) =>
  AIGatewayModelURI.Schema.parse(
    `${type === "openrouter" ? "anthropic" : type}/${canonicalId}?provider=${type}&providerConfigId=${configId}`,
  );

function model(
  canonicalId: string,
  type: AIProviderType,
  configId: string,
  restricted = false,
) {
  return AIGatewayModel.Schema.parse({
    author: "anthropic",
    canonicalId,
    features: ["inputText", "outputText", "tools"],
    name: canonicalId,
    params: { provider: type, providerConfigId: configId },
    providerId: `anthropic/${canonicalId}`,
    providerName: type,
    ...(restricted && {
      restricted: { message: "Not on this plan.", reason: "plan" },
    }),
    tags: [],
    uri: uriOf(canonicalId, type, configId),
  });
}

const NO_ROUTES: ModelRouteTable = {};
const HAIKU = "claude-haiku-5.5";
// The URI another computer chose, through its own Anthropic connection.
const THEIRS = uriOf(HAIKU, "anthropic", "their-anthropic");

describe("routeModel", () => {
  it.each([
    {
      expected: { kind: "exact", uri: uriOf(HAIKU, "anthropic", "mine") },
      input: {
        connections: [connection("mine", "anthropic")],
        models: [],
        routes: NO_ROUTES,
        uri: uriOf(HAIKU, "anthropic", "mine"),
      },
      name: "1. its own connection, even before any list arrives",
    },
    {
      expected: { kind: "exact", uri: uriOf(HAIKU, "anthropic", "mine") },
      input: {
        connections: [connection("mine", "anthropic")],
        models: [],
        routes: { [`anthropic:${HAIKU}`]: "elsewhere" },
        uri: uriOf(HAIKU, "anthropic", "mine"),
      },
      name: "1. its own connection outranks a remembered route",
    },
    {
      expected: { kind: "remembered", uri: uriOf(HAIKU, "anthropic", "b") },
      input: {
        connections: [
          connection("a", "anthropic"),
          connection("b", "anthropic"),
        ],
        models: [model(HAIKU, "anthropic", "a")],
        routes: { [`anthropic:${HAIKU}`]: "b" },
        uri: THEIRS,
      },
      name: "2. the remembered route, even when it lists nothing now",
    },
    {
      expected: {
        key: `anthropic:${HAIKU}`,
        kind: "found",
        providerConfigId: "a",
        uri: uriOf(HAIKU, "anthropic", "a"),
      },
      input: {
        connections: [connection("a", "anthropic")],
        models: [model(HAIKU, "anthropic", "a")],
        routes: { [`anthropic:${HAIKU}`]: "removed" },
        uri: THEIRS,
      },
      name: "2. a remembered connection since removed falls through to 3",
    },
    {
      expected: {
        key: `anthropic:${HAIKU}`,
        kind: "found",
        providerConfigId: "older",
        uri: uriOf(HAIKU, "anthropic", "older"),
      },
      input: {
        connections: [
          connection("older", "anthropic"),
          connection("newer", "anthropic"),
        ],
        models: [
          model(HAIKU, "anthropic", "newer"),
          model(HAIKU, "anthropic", "older"),
        ],
        routes: NO_ROUTES,
        uri: THEIRS,
      },
      name: "3. of two of the same kind, the one added first",
    },
    {
      expected: {
        key: `anthropic:${HAIKU}`,
        kind: "found",
        providerConfigId: "newer",
        uri: uriOf(HAIKU, "anthropic", "newer"),
      },
      input: {
        connections: [
          connection("older", "anthropic"),
          connection("newer", "anthropic"),
        ],
        models: [
          model(HAIKU, "anthropic", "older", true),
          model(HAIKU, "anthropic", "newer"),
        ],
        routes: NO_ROUTES,
        uri: THEIRS,
      },
      name: "3. one that does not restrict the model over one that does",
    },
    {
      expected: {
        key: `anthropic:${HAIKU}`,
        kind: "found",
        providerConfigId: "only",
        uri: uriOf(HAIKU, "anthropic", "only"),
      },
      input: {
        connections: [connection("only", "anthropic")],
        models: [model(HAIKU, "anthropic", "only", true)],
        routes: NO_ROUTES,
        uri: THEIRS,
      },
      name: "3. a restricted one when it is the only one, for its notice",
    },
    {
      expected: {
        key: `anthropic:${HAIKU}`,
        kind: "found",
        providerConfigId: "listing",
        uri: uriOf(HAIKU, "anthropic", "listing"),
      },
      input: {
        // "failing" is connected but its list failed, so it lists nothing.
        connections: [
          connection("failing", "anthropic"),
          connection("listing", "anthropic"),
        ],
        models: [model(HAIKU, "anthropic", "listing")],
        routes: NO_ROUTES,
        uri: THEIRS,
      },
      name: "3. passes over a connection whose list failed",
    },
    {
      expected: { kind: "none" },
      input: {
        connections: [connection("router", "openrouter")],
        models: [model(HAIKU, "openrouter", "router")],
        routes: NO_ROUTES,
        uri: THEIRS,
      },
      name: "4. never another kind of provider, though it lists the model",
    },
    {
      expected: { kind: "none" },
      input: {
        connections: [connection("a", "anthropic")],
        models: [model("claude-sonnet-5.5", "anthropic", "a")],
        routes: NO_ROUTES,
        uri: THEIRS,
      },
      name: "4. a connection of the kind that does not list the model",
    },
    {
      expected: { kind: "none" },
      input: {
        connections: [connection("a", "anthropic")],
        models: [],
        routes: NO_ROUTES,
        uri: "not a model uri",
      },
      name: "4. a URI that does not parse",
    },
  ])("$name", ({ expected, input }) => {
    expect(routeModel(input)).toEqual(expected);
  });
});
