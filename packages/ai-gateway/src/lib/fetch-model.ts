import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { Result } from "typescript-result";

import { AIGatewayModelURI } from "../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { TypedError } from "./errors";
import { fetchModelsForProvider } from "./fetch-models";
import { type ModelCache } from "./model-cache";
import { type ModelRoutes, noopModelRoutes, routeModel } from "./route-model";

/**
 * The model a stored URI names, as this computer reaches it: through the
 * URI's own connection, or, for one another computer chose, the connection
 * `routeModel` settles on here, remembered in `modelRoutes` the first time.
 * The model answered carries the URI it was reached by.
 */
export async function fetchModel({
  captureException,
  configs,
  modelCache,
  modelRoutes = noopModelRoutes,
  modelURI: storedURI,
}: {
  captureException: CaptureExceptionFunction;
  configs: AIGatewayProviderConfig.Type[];
  modelCache: ModelCache;
  modelRoutes?: ModelRoutes;
  modelURI: AIGatewayModelURI.Type;
}) {
  return Result.gen(async function* () {
    const modelURI = await routedURI({
      captureException,
      configs,
      modelCache,
      modelRoutes,
      modelURI: storedURI,
    });
    const [modelURIDetails, error] =
      AIGatewayModelURI.parse(modelURI).toTuple();
    if (error) {
      return Result.error(
        new TypedError.NotFound(`Invalid model URI: ${modelURI}`),
      );
    }

    const config = configs.find(
      (c) => c.id === modelURIDetails.params.providerConfigId,
    );
    if (!config) {
      return Result.error(
        new TypedError.NotFound(
          `Provider config for ${modelURIDetails.params.providerConfigId} not found`,
        ),
      );
    }

    // Resolve from the cache before going to the provider. This runs on task
    // creation, on every new session and message, and on every turn, so a
    // provider round trip here sits directly in front of the user's submit --
    // and the models list the UI subscribes to is what keeps the cache current.
    // The fetch below still covers a cold cache and a model too new to be in
    // one.
    const cachedModel = modelCache
      .read(config.cacheIdentifier)
      ?.find((m) => m.uri === modelURI);
    if (cachedModel) {
      return cachedModel;
    }

    const models = yield* await fetchModelsForProvider(config, {
      captureException,
      modelCache,
    });

    const model = models.find((m) => m.uri === modelURI);
    if (!model) {
      return Result.error(
        new TypedError.NotListed(`Model ${modelURI} not found`),
      );
    }

    return model;
  });
}

/**
 * The URI to reach `modelURI` by on this computer, or the URI itself when
 * nothing here reaches it, for the lookup to report as missing. Reads the
 * cached lists of the URI's kind of connection, and fetches the ones not
 * cached only when the route needs a list and the cache does not settle it.
 */
async function routedURI({
  captureException,
  configs,
  modelCache,
  modelRoutes,
  modelURI,
}: {
  captureException: CaptureExceptionFunction;
  configs: AIGatewayProviderConfig.Type[];
  modelCache: ModelCache;
  modelRoutes: ModelRoutes;
  modelURI: AIGatewayModelURI.Type;
}): Promise<AIGatewayModelURI.Type> {
  const connections = configs.map(({ id, type }) => ({ id, type }));
  const routes = modelRoutes.read();
  const provider =
    AIGatewayModelURI.parse(modelURI).getOrNull()?.params.provider;
  const sameKind = configs.filter((c) => c.type === provider);
  const cached = sameKind.flatMap(
    (c) => modelCache.read(c.cacheIdentifier) ?? [],
  );
  let route = routeModel({
    connections,
    models: cached,
    routes,
    uri: modelURI,
  });
  const uncached = sameKind.filter((c) => !modelCache.read(c.cacheIdentifier));
  if (route.kind === "none" && uncached.length > 0) {
    const fetched = await Promise.all(
      uncached.map((c) =>
        fetchModelsForProvider(c, { captureException, modelCache }),
      ),
    );
    route = routeModel({
      connections,
      models: [
        ...cached,
        ...fetched.flatMap((result) => result.getOrNull() ?? []),
      ],
      routes,
      uri: modelURI,
    });
  }
  if (route.kind === "none") {
    return modelURI;
  }
  if (route.kind === "found") {
    modelRoutes.remember(route.key, route.providerConfigId);
  }
  return route.uri;
}
