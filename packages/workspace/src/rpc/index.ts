import { browser } from "./routes/browser";
import { debug } from "./routes/debug";
import { message } from "./routes/message";
import { pin } from "./routes/pin";
import { project } from "./routes/project";
import { replay } from "./routes/replay";
import { runtime } from "./routes/runtime";
import { server } from "./routes/server";
import { session } from "./routes/session";
import { storage } from "./routes/storage";
import { task } from "./routes/task";

export const router = {
  browser,
  debug,
  message,
  pin,
  project,
  replay,
  runtime,
  server,
  session,
  storage,
  task,
};
