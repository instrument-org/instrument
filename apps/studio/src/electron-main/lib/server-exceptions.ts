import { ulid } from "ulid";

import { publisher } from "../rpc/publisher";

interface ServerException {
  code?: string;
  /** The long form behind `message`: a stack, or a serialized non-`Error`. */
  details?: string;
  id: string;
  message: string;
  rpcPath?: string;
  timestamp: number;
}

const EXCEPTIONS: ServerException[] = [];

export function addServerException(exception: {
  code?: string;
  details?: string;
  message: string;
  rpcPath?: string;
}) {
  EXCEPTIONS.push({
    ...exception,
    id: ulid(),
    timestamp: Date.now(),
  });
  publisher.publish("server-exceptions.updated", null);
}

export function clearServerExceptions() {
  EXCEPTIONS.length = 0;
  publisher.publish("server-exceptions.updated", null);
}

export function getServerExceptions(): ServerException[] {
  return EXCEPTIONS;
}
