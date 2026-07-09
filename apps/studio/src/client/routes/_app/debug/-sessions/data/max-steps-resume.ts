import { SYNTHETIC_MODEL_ID } from "@instrument-org/shared";
import { StoreId } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

const MAX_STEP_COUNT = 200;

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();
const maxStepsMessageId = StoreId.newMessageId();

// The "Resume the agent" prompt only renders when the last message is a
// synthetic assistant message with finishReason "max-steps" and the agent is
// no longer running. Toggle "Agent Running" off in the debug controls to see it.
registerSession({
  messages: [
    builder.userMessage(
      "Migrate the whole codebase from JavaScript to TypeScript and fix every type error.",
    ),
    builder.assistantMessage(
      "Converting files to TypeScript and resolving type errors across the project. This is a large migration, so I'll work through the modules one at a time.",
    ),
    {
      id: maxStepsMessageId,
      metadata: {
        createdAt: builder.nextTime(),
        finishReason: "max-steps",
        modelId: SYNTHETIC_MODEL_ID,
        providerId: "system",
        sessionId,
        synthetic: true,
      },
      parts: [
        builder.textPart(
          `Agent stopped due to maximum steps (${MAX_STEP_COUNT}).`,
          maxStepsMessageId,
        ),
      ],
      role: "assistant",
    },
  ],
  name: "Max Steps: Resume Prompt",
});
