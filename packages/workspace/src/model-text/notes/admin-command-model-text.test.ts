import { describe, expect, it } from "vitest";

import { adminAskOpenModelNote } from "./admin-command-model-text";

describe("adminAskOpenModelNote", () => {
  it("says the card is still up, and not to ask again", () => {
    expect(
      adminAskOpenModelNote({
        commands: ["systemsetup -settimezone America/New_York"],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The card to run \`systemsetup -settimezone America/New_York\` as an administrator is still up. Answer the user's question; don't ask to run it again.
      </instrument-system-note>"
    `);
  });

  it("names each card that is up", () => {
    expect(
      adminAskOpenModelNote({ commands: ["date", "systemsetup -gettimezone"] }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The card to run \`date\` as an administrator is still up. The card to run \`systemsetup -gettimezone\` as an administrator is still up. Answer the user's question; don't ask to run them again.
      </instrument-system-note>"
    `);
  });
});
