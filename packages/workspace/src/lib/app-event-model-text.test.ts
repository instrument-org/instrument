import { describe, expect, it } from "vitest";

import { appEventModelNote } from "./app-event-model-text";

describe("the note an app event wakes the chat with", () => {
  it("sends a web app's connection to the browser, not to app call", () => {
    expect(
      appEventModelNote({
        apps: {},
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
      - The user says they are signed in to Google Drive (google-drive) on the web, in Instrument's browser. It is connected. Work it there: open https://drive.google.com in a tab, where the sign-in holds, or use a tab already open there. No \`instrument app\` call reaches it. If its account is plain (the page you are on shows it, or the user said it), name it: \`instrument app account google-drive '<account>'\`. Don't hunt for it.
      Nobody typed anything; this note is why you are awake. Tell the user in one line where things stand, and finish what they asked for if it was waiting on this.
      </instrument-system-note>"
    `);
  });

  it("tells this computer's connections to a session last told another's", () => {
    expect(
      appEventModelNote({
        apps: {
          linear: { connected: true, fingerprint: "a", name: "Linear" },
          slack: { connected: false, fingerprint: "b", name: "Slack" },
        },
        carried: true,
        events: [],
        otherComputer: true,
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      You were last told about apps on another computer. Each computer has its own sign-ins and keys; on this one:
      - Connected: Linear (linear).
      - Not connected here: Slack (slack).
      It is only so you know: answer what the user wrote.
      </instrument-system-note>"
    `);
  });

  it("says a change carried on the user's message is only for knowing", () => {
    expect(
      appEventModelNote({
        apps: {},
        carried: true,
        events: [{ event: "removed", name: "Slack", slug: "slack" }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      An app changed:
      - Slack (slack) was removed: its folder is gone along with its sign-in or key. Set it up again with \`instrument app new\` only if the user asks for it.
      This changed outside the conversation since your last turn. It is only so you know: answer what the user wrote.
      </instrument-system-note>"
    `);
  });

  it("gives a sign-in that did not connect the way on to the web", () => {
    const ended = (["refused", "failed", "canceled", "expired"] as const).map(
      (how) =>
        appEventModelNote({
          apps: {},
          events: [
            {
              detail:
                how === "refused"
                  ? "access_denied: AADSTS65001: The user or administrator has not consented to use the application."
                  : how === "failed"
                    ? "HTTP 500: registration failed"
                    : undefined,
              event: "failed",
              name: "Outlook",
              signIn: { ended: how, web: "https://outlook.office.com" },
              slug: "outlook",
            },
          ],
        }).split("\n")[3],
    );
    expect(ended).toMatchInlineSnapshot(`
      [
        "- Outlook (outlook) refused to connect this account directly: access_denied: AADSTS65001: The user or administrator has not consented to use the application. That is the service's rule, not the user declining, and trying the same sign-in again meets it again. Next, sign in on the web in Instrument's browser: \`instrument app new outlook --web https://outlook.office.com --force\`, then connect_app; its card opens the site, and the app is worked in a tab there.",
        "- Signing in to Outlook (outlook) failed: HTTP 500: registration failed. Next, sign in on the web in Instrument's browser: \`instrument app new outlook --web https://outlook.office.com --force\`, then connect_app; its card opens the site, and the app is worked in a tab there.",
        "- The user stopped signing in to Outlook (outlook) before it finished. The card offers signing in on the web or trying again; ask which in a line. For the web: \`instrument app new outlook --web https://outlook.office.com --force\`, then connect_app. To try again: connect_app as it is.",
        "- The sign-in to Outlook (outlook) was left unfinished and lapsed. The card offers signing in on the web or trying again; ask which in a line. For the web: \`instrument app new outlook --web https://outlook.office.com --force\`, then connect_app. To try again: connect_app as it is.",
      ]
    `);
  });

  it("names the site to find when the directory has none", () => {
    expect(
      appEventModelNote({
        apps: {},
        events: [
          {
            event: "failed",
            name: "Acme",
            signIn: { ended: "failed" },
            slug: "acme",
          },
        ],
      }).split("\n")[3],
    ).toMatchInlineSnapshot(
      `"- Signing in to Acme (acme) failed. Next, sign in on the web in Instrument's browser: \`instrument app new acme --web <the service's site> --force\`, then connect_app; its card opens the site, and the app is worked in a tab there."`,
    );
  });

  it("keeps a decline a decline", () => {
    expect(
      appEventModelNote({
        apps: {},
        events: [{ event: "declined", name: "Outlook", slug: "outlook" }],
      }).split("\n")[3],
    ).toMatchInlineSnapshot(
      `"- The user declined to connect Outlook (outlook). Do not ask again unless they bring it up; say what you cannot do without it, in a line, and carry on with what you can."`,
    );
  });

  it("says a card with several apps is answered once, with what the user did on each", () => {
    expect(
      appEventModelNote({
        apps: {},
        events: [
          {
            account: "you@example.com",
            event: "connected",
            name: "Gmail",
            slug: "gmail",
          },
          {
            account: "you@example.com",
            event: "connected",
            name: "Google Drive",
            slug: "drive",
          },
          { event: "declined", name: "Google Slides", slug: "slides" },
        ],
        signIns: [
          {
            account: "you@example.com",
            name: "Google Drive",
            slug: "drive",
            standing: "connected",
          },
          { name: "Google Slides", slug: "slides", standing: "declined" },
          {
            account: "you@example.com",
            name: "Gmail",
            slug: "gmail",
            standing: "connected",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Apps changed:
      - The user signed in to Gmail (gmail). It is connected. Use it now: \`instrument app tools gmail\`, then \`instrument app call\`. It is signed in as you@example.com.
      - The user signed in to Google Drive (drive). It is connected. Use it now: \`instrument app tools drive\`, then \`instrument app call\`. It is signed in as you@example.com.
      - The user declined to connect Google Slides (slides). Do not ask again unless they bring it up; say what you cannot do without it, in a line, and carry on with what you can.
      Every app on your sign-in card is answered, and this is the one note it sends: connected: Google Drive (drive) as you@example.com, Gmail (gmail) as you@example.com; skipped by the user: Google Slides (slides). Answer it in one message: which apps are connected, as which account where it is named, and which the user skipped.
      Nobody typed anything; this note is why you are awake. Tell the user in one line where things stand, and finish what they asked for if it was waiting on this.
      </instrument-system-note>"
    `);
  });

  it("says where a card stands when one of its sign-ins does not connect", () => {
    expect(
      appEventModelNote({
        apps: {},
        events: [{ event: "failed", name: "Google Docs", slug: "docs" }],
        signIns: [
          {
            account: "you@example.com",
            name: "Google Drive",
            slug: "drive",
            standing: "connected",
          },
          { name: "Google Docs", slug: "docs", standing: "failed" },
          { name: "Gmail", slug: "gmail", standing: "waiting" },
        ],
      }).split("\n")[4],
    ).toMatchInlineSnapshot(
      `"Your sign-in card as it stands: connected: Google Drive (drive) as you@example.com; did not connect: Google Docs (docs); not answered yet: Gmail (gmail). The card shows the user the count, so leave it out; you are woken once more when no app on it is waiting."`,
    );
  });
});
