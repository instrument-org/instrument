import { liveRead } from "@instrument-org/workspace/electron";
import {
  answerSetupStep,
  finishSetup,
  readSetupState,
} from "@/electron-main/lib/setup-state";
import { base } from "@/electron-main/rpc/base";
import { SetupStepSchema } from "@/shared/setup";
import { z } from "zod";

import { publisher } from "../publisher";

const answer = base
  .input(z.object({ step: SetupStepSchema }))
  .handler(({ input }) => {
    answerSetupStep(input.step);
  });

const finish = base.handler(() => {
  finishSetup();
});

const live = {
  state: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("setup.updated", { signal })],
      read: readSetupState,
    });
  }),
};

export const setup = {
  answer,
  finish,
  live,
};
