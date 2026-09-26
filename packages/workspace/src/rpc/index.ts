import { browser } from "./routes/browser";
import { computer } from "./routes/computer";
import { debug } from "./routes/debug";
import { message } from "./routes/message";
import { orchestrator } from "./routes/orchestrator";
import { pin } from "./routes/pin";
import { project } from "./routes/project";
import { replay } from "./routes/replay";
import { session } from "./routes/session";
import { skill } from "./routes/skill";
import { storage } from "./routes/storage";
import { systemOne } from "./routes/system-one";
import { task } from "./routes/task";

export const router = {
  browser,
  computer,
  debug,
  message,
  orchestrator,
  pin,
  project,
  replay,
  session,
  skill,
  storage,
  systemOne,
  task,
};
