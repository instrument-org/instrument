import { type ErrorMap, os } from "@orpc/server";

import { hasToken } from "../platform-api/utils";
import { isDeveloperMode } from "../stores/preferences";
import { type InitialRPCContext } from "./context";

const ORPC_ERRORS = {
  API_ERROR: {},
  NOT_FOUND: {},
  UNAUTHORIZED: {},
} as const satisfies ErrorMap;

const osBase = os.$context<InitialRPCContext>().errors(ORPC_ERRORS);

export const base = osBase.$context<InitialRPCContext>();

const authRequired = osBase.middleware(async ({ errors, next }) => {
  if (!hasToken()) {
    throw errors.UNAUTHORIZED();
  }

  return next();
});

export const authenticated = base.use(authRequired);

const devOnlyMiddleware = osBase.middleware(({ errors, next }) => {
  if (!isDeveloperMode()) {
    throw errors.UNAUTHORIZED({ message: "Developer mode required" });
  }
  return next();
});

export const devOnly = base.use(devOnlyMiddleware);
