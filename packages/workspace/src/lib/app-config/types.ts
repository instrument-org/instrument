import { type ProjectSubdomain } from "../../schemas/subdomains";

// The carrier object is gone: a task is identified by its id (the subdomain,
// which is also the folder name), and its directory is derived on demand via
// taskDir(id). `AppConfig`/`AppConfigProject` are transitional aliases for the
// id, removed when subdomain→id lands.
export type AppConfig = ProjectSubdomain;
export type AppConfigProject = ProjectSubdomain;
