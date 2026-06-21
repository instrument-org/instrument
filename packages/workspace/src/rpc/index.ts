import { app } from "./routes/app";
import { browser } from "./routes/browser";
import { debug } from "./routes/debug";
import { message } from "./routes/message";
import { project } from "./routes/project";
import { replay } from "./routes/replay";
import { runtime } from "./routes/runtime";
import { session } from "./routes/session";

export const router = {
  app,
  browser,
  debug,
  message,
  project,
  replay,
  runtime,
  session,
};
