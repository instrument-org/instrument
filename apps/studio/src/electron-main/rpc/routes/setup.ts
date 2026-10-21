import { liveRead } from "@instrument-org/workspace/electron";
import {
  answerSetupStep,
  backFromSetupStep,
  finishSetup,
  readSetupState,
  resetSetup,
  setupStateKnown,
} from "@/electron-main/lib/setup-state";
import { startSetupFacts } from "@/electron-main/lib/setup-facts";
import { base, devOnly } from "@/electron-main/rpc/base";
import { SetupStepSchema } from "@/shared/setup";
import { z } from "zod";

import { publisher } from "../publisher";

startSetupFacts();

const answer = base
  .input(z.object({ step: SetupStepSchema }))
  .handler(({ input }) => {
    answerSetupStep(input.step);
  });

/** Back from `step` to the step before it, which setup asks again. */
const back = base
  .input(z.object({ step: SetupStepSchema }))
  .handler(({ input }) => {
    backFromSetupStep(input.step);
  });

const finish = base.handler(() => {
  finishSetup();
});

const live = {
  state: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [publisher.subscribe("setup.updated", { signal })],
      read: async () => {
        await setupStateKnown();
        return readSetupState();
      },
    });
  }),
};

const dev = {
  /** Forgets every answer, so setup runs again from its first step. */
  reset: devOnly.handler(() => {
    resetSetup();
  }),
};

export const setup = {
  answer,
  back,
  dev,
  finish,
  live,
};
