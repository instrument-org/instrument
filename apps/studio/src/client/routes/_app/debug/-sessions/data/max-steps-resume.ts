import { SYNTHETIC_MODEL_ID } from "@instrument-org/shared";
import { StoreId } from "@instrument-org/workspace/client";

import { type PresetSessionData, SessionBuilder } from "../helpers";

const MAX_STEP_COUNT = 200;

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();
const maxStepsMessageId = StoreId.newMessageId();

// The "Resume the agent" prompt renders when the last message is a synthetic
// assistant message with finishReason "max-steps" and the agent is no longer
// running. The max-steps state is carried by a hidden `data-maxSteps` part
// (not visible assistant text), so the alert is the only user-facing affordance.
// Toggle "Agent Running" off in the debug controls to see the alert; toggle
// "Developer Mode" on to reveal the `data-maxSteps` debug card (the system note
// injected into the model's prompt on resume).
export const session: PresetSessionData = {
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
        {
          data: { maxStepCount: MAX_STEP_COUNT },
          metadata: {
            createdAt: builder.nextTime(),
            id: StoreId.newPartId(),
            messageId: maxStepsMessageId,
            sessionId,
          },
          type: "data-maxSteps",
        },
      ],
      role: "assistant",
    },
  ],
  name: "Max Steps: Resume Prompt",
};
