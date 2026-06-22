import { type TaskId } from "../../schemas/task-id";

// The carrier object is gone: a task is identified by its id (the id,
// which is also the folder name), and its directory is derived on demand via
// taskDir(id). `AppConfig`/`AppConfigProject` are transitional aliases for the
// id, removed when id→id lands.
export type AppConfig = TaskId;
export type AppConfigProject = TaskId;
