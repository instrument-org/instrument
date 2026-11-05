import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import {
  forgetRecordedActions,
  type RecordedAction,
  recordActions,
} from "../../test/helpers/recorded-actions";
import { createActivityCommand } from "../shell-commands/activity";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

const chatId = ChatIdSchema.parse("activity-test");
const HOME = "/Users/mac-user";
/** 2:30 PM on Thursday, November 5, on this computer's clock. */
const NOW = new Date(2026, 10, 5, 14, 30);

/** Records each action at its own time on this computer's clock. */
function logged(actions: [Date, RecordedAction][]) {
  recordActions(actions.map(([when, action]) => [when.getTime(), action]));
}

/** A time `minutes` before `NOW`. */
function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

async function activity(...args: string[]) {
  const command = createActivityCommand({
    chatId,
    role: "task",
    sessionId: StoreId.newSessionId(),
  });
  return command.execute(
    args,
    createCommandContext({
      cwd: "/work",
      env: new Map(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  forgetRecordedActions();
});

describe("instrument activity", () => {
  it("lists what the user did by day and local time, names and paths in full", async () => {
    const yesterday = new Date(2026, 10, 4, 21, 5);
    logged([
      [yesterday, { kind: "folder", path: `${HOME}/Pictures/Lisbon 2025` }],
      [
        ago(40),
        {
          kind: "folder",
          path: `${HOME}/Downloads`,
          selected: ["invoice-0931.pdf", "invoice-0932.pdf"],
        },
      ],
      [
        ago(16),
        {
          from: `${HOME}/Downloads`,
          kind: "move",
          names: ["invoice-0931.pdf", "invoice-0932.pdf"],
          to: `${HOME}/Documents/Archive/2023`,
        },
      ],
      [
        ago(12),
        {
          id: "kitchen-remodel-quotes",
          kind: "chat",
          title: "Kitchen remodel quotes",
        },
      ],
      [ago(11), { id: chatId, kind: "chat", title: "This chat" }],
      [
        ago(9),
        {
          kind: "page",
          title: "Where's My Refund?",
          url: "https://www.irs.gov/refunds",
        },
      ],
      [
        ago(8),
        {
          kind: "download",
          path: `${HOME}/Downloads/Globex NDA.txt`,
          url: "https://globex.example/nda.txt",
        },
      ],
      [ago(7), { kind: "edit", path: `${HOME}/Documents/Trips/Lisbon.md` }],
      [
        ago(6),
        {
          kind: "error",
          message: "Couldn't show “scan-0412.heic”.",
          where: "file viewer",
        },
      ],
      [ago(5), { dropped: 14, kind: "capped", of: "file" }],
      [ago(4), { kind: "trash", paths: [`${HOME}/Desktop/old.txt`] }],
      [ago(3), { kind: "screen", name: "Settings › Models" }],
      [ago(2), { kind: "setting", name: "Theme", value: "Dark" }],
      [ago(0), { app: "Preview", kind: "open-with", path: `${HOME}/a.pdf` }],
    ]);

    const result = await activity("--since", "1d");

    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "What the user did in Instrument on this computer in the last 1d, oldest first, at their local time. Only what happened in Instrument is here: a file they downloaded or saved in another app is not.
      Wednesday, November 4
        9:05 PM  opened the folder /Users/mac-user/Pictures/Lisbon 2025 in Files
      Thursday, November 5
        1:50 PM  opened the folder /Users/mac-user/Downloads in Files, with invoice-0931.pdf, invoice-0932.pdf selected
        2:14 PM  moved invoice-0931.pdf, invoice-0932.pdf from /Users/mac-user/Downloads into /Users/mac-user/Documents/Archive/2023
        2:18 PM  read the chat "Kitchen remodel quotes", its records in $INSTRUMENT_CHATS/kitchen-remodel-quotes
        2:21 PM  visited "Where's My Refund?" at https://www.irs.gov/refunds
        2:22 PM  downloaded /Users/mac-user/Downloads/Globex NDA.txt from https://globex.example/nda.txt
        2:23 PM  edited and saved /Users/mac-user/Documents/Trips/Lisbon.md
        2:24 PM  saw the error "Couldn't show “scan-0412.heic”." (file viewer)
        2:25 PM  (14 more file actions were left out here, past the log's limit)
        2:26 PM  moved /Users/mac-user/Desktop/old.txt to the Trash
        2:27 PM  opened Settings › Models
        2:28 PM  changed the setting "Theme" to "Dark"
        2:30 PM  opened /Users/mac-user/a.pdf in Preview
      "
    `);
  });

  it("reaches back 2 hours when not told, and keeps the newest rows under --limit", async () => {
    logged([
      [ago(150), { kind: "file", path: `${HOME}/too-old.txt` }],
      [ago(30), { kind: "file", path: `${HOME}/one.txt` }],
      [ago(20), { kind: "file", path: `${HOME}/two.txt` }],
      [ago(10), { kind: "file", path: `${HOME}/three.txt` }],
    ]);

    expect((await activity("--limit", "2")).stdout).toMatchInlineSnapshot(`
      "What the user did in Instrument on this computer in the last 2h, oldest first, at their local time. Only what happened in Instrument is here: a file they downloaded or saved in another app is not.
      (1 earlier not shown; --limit raises it)
      Thursday, November 5
        2:10 PM  opened /Users/mac-user/two.txt
        2:20 PM  opened /Users/mac-user/three.txt
      "
    `);
  });

  it("keeps the rows that mention --grep, in any case", async () => {
    logged([
      [ago(30), { kind: "file", path: `${HOME}/Taxes/1099-INT Chase.txt` }],
      [ago(20), { kind: "file", path: `${HOME}/Trips/Lisbon.md` }],
    ]);

    expect((await activity("list", "--grep", "chase")).stdout)
      .toMatchInlineSnapshot(`
        "What the user did in Instrument on this computer in the last 2h, where it mentions "chase", oldest first, at their local time. Only what happened in Instrument is here: a file they downloaded or saved in another app is not.
        Thursday, November 5
          2:00 PM  opened /Users/mac-user/Taxes/1099-INT Chase.txt
        "
      `);
  });

  it("says when nothing matched, and how to look further back", async () => {
    logged([[ago(45), { kind: "file", path: `${HOME}/one.txt` }]]);

    expect((await activity("--grep", "contract")).stdout).toMatchInlineSnapshot(
      `
      "Nothing the user did in Instrument on this computer in the last 2h mentions "contract". \`instrument activity --since 1d\` looks further back.
      "
    `,
    );
    expect((await activity("--since", "30m")).stdout).toMatchInlineSnapshot(`
      "Nothing the user did in Instrument on this computer in the last 30m was logged. \`instrument activity --since 1d\` looks further back.
      "
    `);
  });

  it("refuses a --since it cannot read", async () => {
    const result = await activity("--since", "yesterday");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument activity: --since takes minutes, hours or days: 30m, 2h or 1d.
      "
    `);
  });

  it("refuses while the user keeps what they do to themselves", async () => {
    logged([[ago(30), { kind: "file", path: `${HOME}/one.txt` }]]);
    const config = getWorkspaceConfig();
    setWorkspaceConfig({ ...config, mayShareActions: () => false });
    try {
      const result = await activity();

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatchInlineSnapshot(`
        "instrument activity: the user turned this off in Settings › Activity, so what they do in the app is not shared.
        "
      `);
    } finally {
      setWorkspaceConfig(config);
    }
  });
});
