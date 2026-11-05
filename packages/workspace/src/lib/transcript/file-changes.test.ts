import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHAT_FILE_NAME,
  CHAT_FOLDER_NAMES,
  FOLDER_VARIABLES,
} from "../../constants";
import {
  fileTouches,
  foldersEntered,
  pathsNamedIn,
  watchCall,
} from "./file-changes";

let root: string;
let work: string;
let elsewhere: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "file-changes-"));
  work = path.join(root, "work");
  elsewhere = path.join(root, "elsewhere");
  await fs.mkdir(work);
  await fs.mkdir(elsewhere);
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

const watch = () =>
  watchCall({
    folders: [work],
    home: root,
    outputFolder: elsewhere,
    workFolder: work,
  });

const write = (at: string, words = "x") => fs.writeFile(at, words);

describe("fileTouches", () => {
  it("tells what a program made, changed and removed in the chat's folders", async () => {
    await write(path.join(work, "kept.md"), "old");
    await write(path.join(work, "gone.md"));
    const watching = await watch();
    await write(path.join(work, "new.md"));
    await write(path.join(work, "kept.md"), "older");
    await fs.rm(path.join(work, "gone.md"));
    const { files } = await fileTouches(watching, {
      command: "python build.py",
      output: "",
    });
    expect(
      files
        .map((file) => `${file.change} ${path.basename(file.path)}`)
        .toSorted(),
    ).toEqual(["changed kept.md", "created new.md", "deleted gone.md"]);
  });

  it("says nothing was deleted when a folder holds more than a look reads", async () => {
    await Promise.all(
      Array.from({ length: 2100 }, (_, index) =>
        write(path.join(work, `old-${index.toString()}.txt`)),
      ),
    );
    await fs.utimes(work, new Date(0), new Date(0));
    const watching = await watch();
    await fs.mkdir(path.join(work, "a-new-folder"));
    await write(path.join(work, "a-new-folder", "new.txt"));
    const { files } = await fileTouches(watching, {
      command: "python build.py",
      output: "",
    });
    expect(files.filter((file) => file.change === "deleted")).toEqual([]);
  });

  it("leaves out the chat's own file, command logs and the system's clutter", async () => {
    const watching = await watch();
    await fs.mkdir(path.join(work, CHAT_FOLDER_NAMES.toolOutput));
    const log = path.join(work, CHAT_FOLDER_NAMES.toolOutput, "bg_1.log");
    await write(log);
    await write(path.join(work, CHAT_FILE_NAME));
    await write(path.join(work, ".DS_Store"));
    await write(path.join(work, "report.csv"));
    const { files } = await fileTouches(watching, {
      command: "python build.py",
      output: `The log is at ${log}`,
    });
    expect(files.map((touch) => path.basename(touch.path))).toEqual([
      "report.csv",
    ]);
  });

  it("finds a file outside those folders by a name in the command", async () => {
    const watching = await watch();
    const file = path.join(elsewhere, "report.csv");
    await write(file);
    const { files } = await fileTouches(watching, {
      command: `python - <<'EOF'\nopen("${file}", "w")\nEOF`,
      output: "",
    });
    expect(files).toEqual([{ change: "created", path: file, via: "disk" }]);
  });

  it("finds one by a name only its output says", async () => {
    const watching = await watch();
    const file = path.join(elsewhere, "report.csv");
    await write(file);
    const { files } = await fileTouches(watching, {
      command: "python build.py",
      output: `Wrote ${file}\n`,
    });
    expect(files.map((touch) => touch.path)).toEqual([file]);
  });

  it("reads the shell's folder variables, a home and a folder it moved to", async () => {
    await fs.mkdir(path.join(elsewhere, "sub"));
    const watching = await watch();
    const output = path.join(elsewhere, "note.md");
    const inHome = path.join(root, "home-note.md");
    const inSub = path.join(elsewhere, "sub", "deep.txt");
    await write(output);
    await write(inHome);
    await write(inSub);
    const { files } = await fileTouches(watching, {
      command: `cat > "$${FOLDER_VARIABLES.output}/note.md"; cp x ~/home-note.md; cd "${elsewhere}/sub" && touch deep.txt`,
      output: "",
    });
    expect(files.map((touch) => touch.path).toSorted()).toEqual(
      [output, inHome, inSub].toSorted(),
    );
  });

  it("says nothing of a file named but left alone", async () => {
    const file = path.join(elsewhere, "old.csv");
    await write(file);
    await fs.utimes(file, new Date(0), new Date(0));
    const watching = await watch();
    const { files } = await fileTouches(watching, {
      command: `ls "${file}"`,
      output: file,
    });
    expect(files).toEqual([]);
  });

  it("records what a command's words read, as a guess", async () => {
    const file = path.join(work, "notes.md");
    await write(file);
    await fs.utimes(file, new Date(0), new Date(0));
    const watching = await watch();
    const { files } = await fileTouches(watching, {
      command: "head -20 notes.md | wc -l",
      output: "",
    });
    expect(files).toEqual([{ change: "read", path: file, via: "command" }]);
  });

  it("does not tell the same file twice", async () => {
    const watching = await watch();
    const file = path.join(work, "both.md");
    await write(file);
    const { files } = await fileTouches(watching, {
      command: `cat "${file}"`,
      output: file,
    });
    expect(files).toEqual([{ change: "created", path: file, via: "disk" }]);
  });

  it("leaves what a build leaves behind out of it", async () => {
    await fs.mkdir(path.join(work, "node_modules"));
    const watching = await watch();
    await write(path.join(work, "node_modules", "dep.js"));
    const { files } = await fileTouches(watching, {
      command: "npm install",
      output: "",
    });
    expect(files).toEqual([]);
  });
});

describe("pathsNamedIn", () => {
  it.each([
    ['cat > "My Report.md"', ["My Report.md"]],
    ["open('out/chart.png', 'w')", ["out/chart.png"]],
    ["ffmpeg -i a.mp4 b.webm", ["a.mp4", "b.webm"]],
    ["echo hi > $INSTRUMENT_OUTPUT/x.md", ["$INSTRUMENT_OUTPUT/x.md"]],
    ["curl https://example.com/a.png", []],
    ["echo hello", []],
  ])("reads %s", (text, named) => {
    expect(pathsNamedIn(text)).toEqual(named);
  });
});

describe("foldersEntered", () => {
  it("reads the folders a command moves to", () => {
    expect(foldersEntered('cd "$INSTRUMENT_WORK/a" && ls; cd b')).toEqual([
      "$INSTRUMENT_WORK/a",
      "b",
    ]);
  });
});
