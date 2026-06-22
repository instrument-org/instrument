import { browser } from "./routes/browser";
import { debug } from "./routes/debug";
import { message } from "./routes/message";
import { replay } from "./routes/replay";
import { runtime } from "./routes/runtime";
import { server } from "./routes/server";
import { session } from "./routes/session";
import { task } from "./routes/task";

export const router = {
  browser,
  debug,
  message,
  replay,
  runtime,
  server,
  session,
  task,
};
