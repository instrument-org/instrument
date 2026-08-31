import { type AIGatewayTypedError } from "@instrument-org/ai-gateway";
import { type ErrorMap, type ORPCErrorConstructorMap, os } from "@orpc/server";

import { type TypedError } from "../lib/errors";
import { type WorkspaceActorRef } from "../machines/workspace";
import { type WorkspaceConfig } from "../types";

export interface WorkspaceRPCContext {
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}

const ORPC_ERRORS = {
  FILE_SYSTEM_ERROR: {},
  GATEWAY_FETCH_ERROR: {},
  GIT_ERROR: {},
  NOT_FOUND: {},
  PARSE_ERROR: {},
  STORAGE_ERROR: {},
  UNKNOWN: {},
} as const satisfies ErrorMap;

type WorkspaceErrorMap = ORPCErrorConstructorMap<typeof ORPC_ERRORS>;

export const base = os.$context<WorkspaceRPCContext>().errors(ORPC_ERRORS);

export function toORPCError(
  error: AIGatewayTypedError.Type | TypedError.Type,
  orpcErrors: WorkspaceErrorMap,
) {
  // The typed error rides along as the cause, and the throw it wrapped with it.
  // What crosses the wire is only a code and a sentence, and the sentence names
  // what we were doing rather than what went wrong -- one message for every way
  // a walk can fail. Reporting happens on this side of the boundary, where the
  // chain is still an object to read.
  const options = { cause: error, message: error.message };

  switch (error.type) {
    case "gateway-fetch-error": {
      return orpcErrors.GATEWAY_FETCH_ERROR(options);
    }
    case "gateway-not-found-error":
    case "workspace-not-found-error": {
      return orpcErrors.NOT_FOUND(options);
    }
    case "gateway-parse-error":
    case "workspace-parse-error": {
      return orpcErrors.PARSE_ERROR(options);
    }
    case "workspace-filesystem-error": {
      return orpcErrors.FILE_SYSTEM_ERROR(options);
    }
    case "workspace-git-error": {
      return orpcErrors.GIT_ERROR(options);
    }
    case "workspace-storage-error": {
      return orpcErrors.STORAGE_ERROR(options);
    }
    default: {
      return orpcErrors.UNKNOWN(options);
    }
  }
}
