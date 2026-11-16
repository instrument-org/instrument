import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dataDirReadme, writeDataDirReadme } from "./data-dir-readme";

let rootDir: string;
const readme = () => path.join(rootDir, ".instrument", "README.md");

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-dir-readme-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { force: true, recursive: true });
});

describe("the workspace guide in .instrument/README.md", () => {
  it("says what the workspace's folders are", () => {
    expect(dataDirReadme()).toMatchInlineSnapshot(`
      "# .instrument

      This folder is Instrument's, and Instrument rewrites this file at every launch. Read anything in \`.instrument/\`; write nothing here.

      ## The workspace

      The folders beside \`.instrument/\` are the person's, free to read and edit:

      - \`Files/\`: kept work, a folder per piece of work.
      - \`Projects/<Name>/AGENTS.md\`: a project, its \`AGENTS.md\` the instructions every chat filed under it reads.
      - \`Memory/<name>.md\`: one memory per Markdown note.
      - \`Skills/<name>/SKILL.md\`: a skill per folder.
      - \`AGENTS.md\`: instructions every chat reads.

      ## In \`.instrument/\`

      - \`chats/<id>/\`: one folder per chat. \`<session>.<device>.jsonl\` is one session's log as one device wrote it: JSON Lines, one record per line, \`t\` naming the record. A \`session\` record opens it; a \`message\` record's words are in the \`part\` records whose \`part.metadata.messageId\` names it, and the newest record of a part's id stands. \`settings.<device>.jsonl\` holds \`set\` records, the newest per \`session\` and \`field\` standing, and \`blobs/\` the bytes a part names.
      - \`devices/<device>/\`: per-device \`.jsonl\` stores, each written by its own device alone: a \`set\` or \`del\` line per change, the newest line per \`key\` across devices standing.
      - \`drafts/<date>/DRAFT.md\`: a message the person has not sent yet, with what goes with it beside it.
      "
    `);
  });

  it("is written where it is missing, then left alone while it matches", async () => {
    expect(await writeDataDirReadme(rootDir)).toBe(true);
    expect(fs.readFileSync(readme(), "utf8")).toBe(dataDirReadme());
    expect(await writeDataDirReadme(rootDir)).toBe(false);
  });

  it("is written over where it differs, with nothing left beside it", async () => {
    fs.mkdirSync(path.dirname(readme()));
    fs.writeFileSync(readme(), "An older guide.\n");

    expect(await writeDataDirReadme(rootDir)).toBe(true);
    expect(fs.readFileSync(readme(), "utf8")).toBe(dataDirReadme());
    expect(fs.readdirSync(path.dirname(readme()))).toEqual(["README.md"]);
  });
});
