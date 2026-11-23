import { describe, expect, it } from "vitest";

import { noticeFor, readModelStatus } from "./model-status";
import { modelStatusScenarios as cases } from "./model-status-scenarios";

describe("readModelStatus and noticeFor", () => {
  it("say one thing for each state the chosen model can be in", () => {
    const read = Object.fromEntries(
      Object.entries(cases).map(([name, input]) => {
        const status = readModelStatus(input);
        const notice = noticeFor(status);
        return [
          name,
          {
            status: status.kind,
            ...(notice && {
              notice: `[${notice.tone}${notice.dismissible ? ", ×" : ""}] ${notice.text}${notice.action ? ` → ${[notice.action, notice.secondary].flatMap((action) => action?.label ?? []).join(" | ")}` : ""}`,
            }),
          },
        ];
      }),
    );
    expect(read).toMatchInlineSnapshot(`
      {
        "Claude account disconnected": {
          "notice": "[problem] Claude isn't connected anymore, so Claude Opus 4.5 isn't available → Connect Claude | Switch to Auto",
          "status": "gone",
        },
        "Claude account disconnected, nothing else listed": {
          "notice": "[problem] Claude isn't connected anymore, so Claude Opus 4.5 isn't available → Connect Claude | Add a provider",
          "status": "gone",
        },
        "Claude account signed out": {
          "notice": "[problem] You're signed out of Claude → Sign in | Switch to Auto",
          "status": "gone",
        },
        "Instrument logged out": {
          "notice": "[problem] Instrument isn't connected anymore, so Auto isn't available → Log in to Instrument | Choose a model",
          "status": "gone",
        },
        "another computer's connection, one of the kind here": {
          "status": "ready",
        },
        "another computer's connection, only another kind here": {
          "notice": "[problem] Anthropic isn't connected anymore, so Claude Haiku 4.5 isn't available → Switch to OpenRouter | Add a provider",
          "status": "gone",
        },
        "fine": {
          "status": "ready",
        },
        "its provider failed to load": {
          "notice": "[problem] Couldn't load models from OpenRouter → Retry | Switch to Auto",
          "status": "provider-failed",
        },
        "loading": {
          "status": "loading",
        },
        "newer release listed": {
          "notice": "[offer, ×] A newer version of your model is available. Switch to Claude Sonnet 5.5? → Switch",
          "status": "newer",
        },
        "newer release, offer dismissed": {
          "status": "ready",
        },
        "none chosen": {
          "notice": "[problem] No model chosen → Choose a model",
          "status": "none-chosen",
        },
        "nothing listed": {
          "notice": "[problem] No models available → Add a provider",
          "status": "no-models",
        },
        "provider removed, same model elsewhere": {
          "notice": "[problem] Anthropic isn't connected anymore, so Claude Haiku 4.5 isn't available → Switch to OpenRouter | Add a provider",
          "status": "gone",
        },
        "provider removed, same model through OpenRouter and Instrument": {
          "notice": "[problem] Claude Haiku 4.5 isn't available anymore → Switch to Instrument | Add a provider",
          "status": "gone",
        },
        "provider turned off, same model elsewhere": {
          "notice": "[problem] Anthropic is turned off, so Claude Haiku 4.5 isn't available → Enable Anthropic | Switch to OpenRouter",
          "status": "gone",
        },
        "restricted, with Auto to fall back on": {
          "notice": "[problem] Claude Opus 5.5 is unavailable → Switch to Auto",
          "status": "restricted",
        },
        "the list failed": {
          "notice": "[problem] Couldn't load models → Retry",
          "status": "list-failed",
        },
        "withdrawn, its series continues": {
          "notice": "[problem] Anthropic doesn't offer Claude Sonnet 4.5 anymore → Switch to Claude Sonnet 5.5",
          "status": "gone",
        },
        "withdrawn, nothing continues it": {
          "notice": "[problem] Anthropic doesn't offer Mystery Model anymore → Switch to Auto",
          "status": "gone",
        },
      }
    `);
  });
});
