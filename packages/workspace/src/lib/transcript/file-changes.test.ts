import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAT_FOLDER_NAMES, FOLDER_VARIABLES } from "../../constants";
import {
  fileTouches,
  foldersEntered,
  pathsNamedIn,
  watchCall,
} from "./file-changes";

let root: string;
let work: string;
let elsewhere: string;
let filesFolder: string;
let project: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "file-changes-"));
  work = path.join(root, "work");
  elsewhere = path.join(root, "elsewhere");
  filesFolder = path.join(root, "Files");
  project = path.join(root, "Projects", "Trip");
  await fs.mkdir(work);
  await fs.mkdir(elsewhere);
  await fs.mkdir(filesFolder);
  await fs.mkdir(project, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

const watch = (command: string) =>
  watchCall({
    command,
    filesFolder,
    home: root,
    projectFolder: project,
    workFolder: work,
  });

const write = (at: string, words = "x") => fs.writeFile(at, words);

/** Runs `act` as the call `command` would, and says what the call touched. */
async function touchedBy(
  command: string,
  act: () => Promise<unknown>,
  output = "",
) {
  const watching = await watch(command);
  await act();
  return fileTouches(watching, { command, output });
}

const brief = (touches: readonly { change: string; path: string }[]) =>
  touches
    .map(
      (touch) =>
        `${touch.change} ${path.relative(root, touch.path).replaceAll(path.sep, "/")}`,
    )
    .toSorted();

describe("fileTouches", () => {
  it("leaves out the copy the app keeps of a file before the call changes it", async () => {
    const file = path.join(filesFolder, "turtle.svg");
    await write(file, "<svg>plain</svg>");
    const { files } = await touchedBy("python cuter.py", async () => {
      await fs.mkdir(path.join(work, "Versions", "turtle.svg"), {
        recursive: true,
      });
      await write(
        path.join(work, "Versions", "turtle.svg", "v2.svg"),
        "<svg>plain</svg>",
      );
      await write(file, "<svg>cute</svg>");
    });
    expect(brief(files)).toEqual([]);
  });

  it("tells what a program made, changed and removed in the chat's folders", async () => {
    await write(path.join(work, "kept.md"), "old");
    await write(path.join(work, "gone.md"));
    const { files } = await touchedBy("python build.py", async () => {
      await write(path.join(work, "new.md"));
      await write(path.join(work, "kept.md"), "older");
      await fs.rm(path.join(work, "gone.md"));
    });
    expect(brief(files)).toMatchInlineSnapshot(`
      [
        "changed work/kept.md",
        "created work/new.md",
        "deleted work/gone.md",
      ]
    `);
  });

  it("says nothing was deleted when a folder holds more than a look reads", async () => {
    await Promise.all(
      Array.from({ length: 2100 }, (_, index) =>
        write(path.join(work, `old-${index.toString()}.txt`)),
      ),
    );
    await fs.utimes(work, new Date(0), new Date(0));
    const { files } = await touchedBy("python build.py", async () => {
      await fs.mkdir(path.join(work, "a-new-folder"));
      await write(path.join(work, "a-new-folder", "new.txt"));
    });
    expect(files.filter((file) => file.change === "deleted")).toEqual([]);
  });

  it("leaves out command logs and the system's clutter", async () => {
    const log = path.join(work, CHAT_FOLDER_NAMES.toolOutput, "bg_1.log");
    const { files } = await touchedBy(
      "python build.py",
      async () => {
        await fs.mkdir(path.join(work, CHAT_FOLDER_NAMES.toolOutput));
        await write(log);
        await write(path.join(work, ".DS_Store"));
        await write(path.join(work, "report.csv"));
      },
      `The log is at ${log}`,
    );
    expect(brief(files)).toMatchInlineSnapshot(`
      [
        "created work/report.csv",
      ]
    `);
  });

  it("finds a file outside those folders by a name in the command", async () => {
    const file = path.join(elsewhere, "report.csv");
    const { files } = await touchedBy(
      `python - <<'EOF'\nopen("${file}", "w")\nEOF`,
      () => write(file),
    );
    expect(files).toEqual([{ change: "created", path: file, via: "disk" }]);
  });

  it("finds one by a name only its output says", async () => {
    const file = path.join(elsewhere, "report.csv");
    const { files } = await touchedBy(
      "python build.py",
      () => write(file),
      `Wrote ${file}\n`,
    );
    expect(files.map((touch) => touch.path)).toEqual([file]);
  });

  it("reads the shell's folder variables, a home and a folder it moved to", async () => {
    await fs.mkdir(path.join(elsewhere, "sub"));
    const { files } = await touchedBy(
      `cat > "$${FOLDER_VARIABLES.files}/note.md"; cp x ~/home-note.md; cd "${elsewhere}/sub" && touch deep.txt`,
      async () => {
        await write(path.join(filesFolder, "note.md"));
        await write(path.join(root, "home-note.md"));
        await write(path.join(elsewhere, "sub", "deep.txt"));
      },
    );
    expect(brief(files)).toMatchInlineSnapshot(`
      [
        "created Files/note.md",
        "created elsewhere/sub/deep.txt",
        "created home-note.md",
      ]
    `);
  });

  it("says nothing of a file named but left alone", async () => {
    const file = path.join(elsewhere, "old.csv");
    await write(file);
    await fs.utimes(file, new Date(0), new Date(0));
    const { files } = await touchedBy(`ls "${file}"`, async () => {}, file);
    expect(files).toEqual([]);
  });

  it("records what a command's words read, as a guess", async () => {
    const file = path.join(work, "notes.md");
    await write(file);
    await fs.utimes(file, new Date(0), new Date(0));
    const { files } = await touchedBy(
      "head -20 notes.md | wc -l",
      async () => {},
    );
    expect(files).toEqual([{ change: "read", path: file, via: "command" }]);
  });

  it("does not tell the same file twice", async () => {
    const file = path.join(work, "both.md");
    const { files } = await touchedBy(`cat "${file}"`, () => write(file), file);
    expect(files).toEqual([{ change: "created", path: file, via: "disk" }]);
  });

  it("leaves what a build leaves behind out of it", async () => {
    await fs.mkdir(path.join(work, "node_modules"));
    const { files } = await touchedBy("npm install", () =>
      write(path.join(work, "node_modules", "dep.js")),
    );
    expect(files).toEqual([]);
  });

  it.each([
    ["a program that names no shared folder", "python build.py"],
    [
      "a command that names another folder",
      `cp a.md "$${FOLDER_VARIABLES.files}/Mine/"`,
    ],
    [
      "a command that names another file",
      `cp a.md "$${FOLDER_VARIABLES.files}/Mine/a.md"`,
    ],
  ])(
    "credits nothing another writer does in the shared folders during %s",
    async (_, command) => {
      await fs.mkdir(path.join(filesFolder, "Kyoto trip"));
      await write(path.join(filesFolder, "Old.pdf"));
      const { files } = await touchedBy(command, async () => {
        await write(path.join(filesFolder, "Kyoto trip", "day1.md"));
        await fs.rm(path.join(filesFolder, "Old.pdf"));
        await write(path.join(project, "notes.md"));
      });
      expect(brief(files)).toEqual([]);
    },
  );

  it.each([
    [
      "into a folder in Files",
      `cp ../plan.docx "$${FOLDER_VARIABLES.files}/Kyoto trip/"`,
    ],
    [
      "into the project's folder",
      `cp plan.docx "$${FOLDER_VARIABLES.project}/"`,
    ],
    [
      "into the project's folder, braced and bare",
      `cp plan.docx \${${FOLDER_VARIABLES.project}}`,
    ],
    [
      "after moving to a folder in Files",
      `cd "$${FOLDER_VARIABLES.files}/Kyoto trip" && python make.py`,
    ],
  ])("credits a file a command saves %s", async (_, command) => {
    await fs.mkdir(path.join(filesFolder, "Kyoto trip"));
    await fs.mkdir(path.join(filesFolder, "Other"));
    const into = command.includes(FOLDER_VARIABLES.project)
      ? project
      : path.join(filesFolder, "Kyoto trip");
    const { files } = await touchedBy(command, async () => {
      await write(path.join(into, "plan.docx"));
      await write(path.join(filesFolder, "Other", "x.md"));
    });
    expect(brief(files)).toEqual([
      `created ${path.relative(root, path.join(into, "plan.docx")).replaceAll(path.sep, "/")}`,
    ]);
  });

  it("credits a file a command named and removed in Files", async () => {
    await write(path.join(filesFolder, "Old.pdf"));
    const { files } = await touchedBy(
      `rm "$${FOLDER_VARIABLES.files}/Old.pdf"`,
      () => fs.rm(path.join(filesFolder, "Old.pdf")),
    );
    expect(brief(files)).toMatchInlineSnapshot(`
      [
        "deleted Files/Old.pdf",
      ]
    `);
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
