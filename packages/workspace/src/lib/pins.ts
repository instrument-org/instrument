import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";

import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type TypedError } from "./errors";
import {
  getParsedJsonStorageItem,
  setParsedJsonStorageItem,
} from "./parsed-json-storage";
import { getWorkspaceStoreStorage } from "./workspace-store-storage";

const PINS_KEY = "pins";

const PinsSchema = z.array(TaskIdSchema);

export function addPin(id: TaskId) {
  return getPins().andThen((pins) =>
    pins.includes(id) ? okAsync(undefined) : setPins([...pins, id]),
  );
}

export function getPins() {
  return getWorkspaceStoreStorage().andThen((storage) =>
    getParsedJsonStorageItem(PINS_KEY, PinsSchema, storage).orElse(
      defaultOnMissing<TaskId[]>([]),
    ),
  );
}

export function removePin(id: TaskId) {
  return getPins().andThen((pins) => setPins(pins.filter((p) => p !== id)));
}

export function setPins(ids: TaskId[]) {
  return getWorkspaceStoreStorage().andThen((storage) =>
    setParsedJsonStorageItem(PINS_KEY, ids, PinsSchema, storage),
  );
}

function defaultOnMissing<T>(fallback: T) {
  return (error: TypedError.Type) =>
    error.type === "workspace-not-found-error"
      ? okAsync(fallback)
      : errAsync(error);
}
