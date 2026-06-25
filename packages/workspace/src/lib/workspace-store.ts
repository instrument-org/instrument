import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";

import { type ProjectId, ProjectIdSchema } from "../schemas/project-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type TypedError } from "./errors";
import {
  getParsedJsonStorageItem,
  setParsedJsonStorageItem,
} from "./parsed-json-storage";
import { getWorkspaceStoreStorage } from "./workspace-store-storage";

const PINS_KEY = "pins";
const PROJECT_INDEX_KEY = "project-index";

const PinsSchema = z.array(TaskIdSchema);
// Derived map of ProjectId -> on-disk folder name. Rebuildable by scanning
// `projects/`, so it is a cache, never the source of truth.
const ProjectIndexSchema = z.record(ProjectIdSchema, z.string());

export type ProjectIndex = z.output<typeof ProjectIndexSchema>;

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

export function getProjectIndex() {
  return getWorkspaceStoreStorage().andThen((storage) =>
    getParsedJsonStorageItem(
      PROJECT_INDEX_KEY,
      ProjectIndexSchema,
      storage,
    ).orElse(defaultOnMissing<ProjectIndex>({})),
  );
}

export function removePin(id: TaskId) {
  return getPins().andThen((pins) => setPins(pins.filter((p) => p !== id)));
}

export function removeProjectFolder(id: ProjectId) {
  return getProjectIndex().andThen((index) => {
    const { [id]: _removed, ...rest } = index;
    return setProjectIndex(rest);
  });
}

export function setPins(ids: TaskId[]) {
  return getWorkspaceStoreStorage().andThen((storage) =>
    setParsedJsonStorageItem(PINS_KEY, ids, PinsSchema, storage),
  );
}

export function setProjectFolder(id: ProjectId, folderName: string) {
  return getProjectIndex().andThen((index) =>
    setProjectIndex({ ...index, [id]: folderName }),
  );
}

function defaultOnMissing<T>(fallback: T) {
  return (error: TypedError.Type) =>
    error.type === "workspace-not-found-error"
      ? okAsync(fallback)
      : errAsync(error);
}

function setProjectIndex(index: ProjectIndex) {
  return getWorkspaceStoreStorage().andThen((storage) =>
    setParsedJsonStorageItem(
      PROJECT_INDEX_KEY,
      index,
      ProjectIndexSchema,
      storage,
    ),
  );
}
