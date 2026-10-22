import { OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runningModelText } from "./model-change-model-text";

describe("runningModelText", () => {
  it("names the model the user picked", () => {
    expect(
      runningModelText(
        createMockAIGatewayModel({ canonicalId: "claude", name: "Claude" }),
      ),
    ).toMatchInlineSnapshot(
      `"Model: you run on Claude from Test Provider, the model the user picked for this chat. Asked what model you are, name it plainly; you are still Instrument."`,
    );
  });

  it("names a router as itself, never its current pick", () => {
    expect(
      runningModelText(
        createMockAIGatewayModel({
          canonicalId: "auto",
          name: "Auto",
          providerId: OUR_MODELS.text.id,
        }),
      ),
    ).toMatchInlineSnapshot(
      `"Model: you run on Auto from Test Provider, which picks a model for each request; which one answered is not known to you. Asked what model you are, name it plainly; you are still Instrument."`,
    );
  });
});
