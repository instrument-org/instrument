import { app } from "./routes/app";
import { browser } from "./routes/browser";
import { message } from "./routes/message";
import { project } from "./routes/project";
import { registry } from "./routes/registry";
import { runtime } from "./routes/runtime";
import { session } from "./routes/session";

export const router = {
  app,
  browser,
  message,
  project,
  registry,
  runtime,
  session,
};
