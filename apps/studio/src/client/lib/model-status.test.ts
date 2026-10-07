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
              notice: `[${notice.tone}${notice.dismissible ? ", ×" : ""}] ${notice.text}${notice.action ? ` → ${notice.action.label}` : ""}`,
            }),
          },
        ];
      }),
    );
    expect(read).toMatchInlineSnapshot(`
      {
        "fine": {
          "status": "ready",
        },
        "its provider failed to load": {
          "notice": "[problem] Couldn't load models from OpenRouter → Retry",
          "status": "provider-failed",
        },
        "loading": {
          "status": "loading",
        },
        "newer release listed": {
          "notice": "[offer, ×] A newer version, Claude Sonnet 5.5, is out → Switch",
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
          "notice": "[problem] Anthropic isn't connected anymore, so Claude Haiku 4.5 isn't available → Switch to openrouter-key",
          "status": "gone",
        },
        "provider removed, same model through OpenRouter and Instrument": {
          "notice": "[problem] Claude Haiku 4.5 isn't available anymore → Switch to instrument",
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
          "notice": "[problem] anthropic-key doesn't offer Claude Sonnet 4.5 anymore → Switch to Claude Sonnet 5.5",
          "status": "gone",
        },
        "withdrawn, nothing continues it": {
          "notice": "[problem] anthropic-key doesn't offer Mystery Model anymore → Switch to Auto",
          "status": "gone",
        },
      }
    `);
  });
});
