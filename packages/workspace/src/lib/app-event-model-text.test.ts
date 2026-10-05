import { describe, expect, it } from "vitest";

import { appEventModelNote } from "./app-event-model-text";

describe("the note an app event wakes the chat with", () => {
  it("sends a web app's connection to the browser, not to app call", () => {
    expect(
      appEventModelNote({
        events: [
          {
            event: "connected",
            name: "Google Drive",
            slug: "google-drive",
            web: "https://drive.google.com",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      An app changed:
      - The user says they are signed in to Google Drive (google-drive) on the web, in Instrument's browser. It is connected. Work it there: brief a task with https://drive.google.com, which it opens in a tab of its own where the sign-in holds, or hand it a tab already open there with \`task new --tab <id>\`. No \`app\` call reaches it.
      Nobody typed anything; this note is why you are awake. Tell the user in one line where things stand, and finish what they asked for if it was waiting on this.
      </instrument-system-note>"
    `);
  });

  it("says a change carried on the user's message is only for knowing", () => {
    expect(
      appEventModelNote({
        carried: true,
        events: [{ event: "removed", name: "Slack", slug: "slack" }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      An app changed:
      - Slack (slack) was removed: its folder is gone along with its sign-in or key. Set it up again with \`app new\` only if the user asks for it.
      This changed outside the conversation since your last turn. It is only so you know: answer what the user wrote.
      </instrument-system-note>"
    `);
  });
});
