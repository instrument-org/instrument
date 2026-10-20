import { describe, expect, it } from "vitest";

import { classifyProcessList, systemOwned } from "./unsandboxed-process-list";

const allowed = (platform: NodeJS.Platform, name: "ps" | "top", line: string) =>
  classifyProcessList(name, line === "" ? [] : line.split(" "), platform)
    .allowed;

describe("classifyProcessList on macOS", () => {
  it.each([
    "",
    "aux",
    "ax -o pid,comm",
    "-A",
    "-e",
    "-axww",
    "-ef",
    "-p 123 -o pid=,rss=",
    "-o pid,ppid,%cpu,command -r",
    "-m -A",
    "-u mac-user",
    "-cU 501",
    "-t ttys001",
    "-L",
  ])("ps %s runs", (line) => {
    expect(allowed("darwin", "ps", line)).toBe(true);
  });

  it.each([
    "-E",
    "auxE",
    "-ax -E",
    "-p",
    "-X",
    "-N /tmp/kernel",
    "-ax 123",
    "-t /etc/passwd",
    "-t ../../etc/passwd",
    "-o pid,env",
    // In the old form `u` takes no value, so the name is an operand.
    "aux -u mac-user",
  ])("ps %s is refused", (line) => {
    expect(allowed("darwin", "ps", line)).toBe(false);
  });

  it.each([
    "-l 1",
    "-l1",
    "-l 1 -o cpu -n 5",
    "-l 2 -s 1 -stats pid,command,cpu",
    "-l 1 -pid 1",
    "-l 1 -ncols 5",
    "-u -l 1",
  ])("top %s runs", (line) => {
    expect(allowed("darwin", "top", line)).toBe(true);
  });

  it.each(["", "-o cpu", "-l 0", "-l x", "-l 1 5", "-l 1 -X", "-ua -l 1"])(
    "top %s is refused",
    (line) => {
      expect(allowed("darwin", "top", line)).toBe(false);
    },
  );

  it("names what it refused and what it takes", () => {
    expect(classifyProcessList("ps", ["-E"], "darwin")).toMatchInlineSnapshot(`
      {
        "allowed": false,
        "reason": "ps: \`-E\` can't be used here. \`ps\` takes the options that list processes: -A -a -C -c -d -e -f -G -g -h -j -L -l -M -m -O -o -p -r -S -T -t -U -u -v -w -x (or \`ps aux\`); not -E.",
      }
    `);
    expect(classifyProcessList("top", [], "darwin")).toMatchInlineSnapshot(`
      {
        "allowed": false,
        "reason": "top: interactive mode can't be used here. \`top\` runs only in logging mode: \`top -l <samples>\` with -o/-O <key>, -n <count>, -s <delay>, -i, -c, -stats <keys>, -pid, -user, -U, -a/-d/-e, -F/-f, -R/-r, -S, -u, -ncols.",
      }
    `);
  });
});

describe("classifyProcessList on Linux", () => {
  it.each([
    "",
    "aux",
    "axo pid,comm",
    "-ef",
    "-eo pid,comm --sort=-%cpu",
    "aux --sort -%cpu",
    "-ww -e",
    "-p 1 -o pid=,comm=",
    "-C node",
    "--pid 1",
    "-q 1",
    "-x",
    "-eLf",
    "--forest -e",
    "-t pts/0",
    "--no-headers -o pid",
  ])("ps %s runs", (line) => {
    expect(allowed("linux", "ps", line)).toBe(true);
  });

  it.each([
    "e",
    "auxe",
    "ef",
    "-o pid,environ",
    "--format=environ",
    "axo pid,environ",
    "-n /boot/System.map",
    "N /boot/System.map",
    "1234",
    "oxa pid",
    "--help",
    "--bogus",
    "-t /dev/pts/0",
  ])("ps %s is refused", (line) => {
    expect(allowed("linux", "ps", line)).toBe(false);
  });

  it.each([
    "-b -n 1",
    "-bn1",
    "-bn 1 -o %CPU",
    "-b -n 2 -d 0.5 -w 200",
    "-b -w -n 1",
    "-b -n 1 -p 1,2 -u quests",
  ])("top %s runs", (line) => {
    expect(allowed("linux", "top", line)).toBe(true);
  });

  it.each(["", "-n 1", "-b", "-b -n 0", "-b -n 1 -X", "--batch-mode -n 1"])(
    "top %s is refused",
    (line) => {
      expect(allowed("linux", "top", line)).toBe(false);
    },
  );
});

it("refuses both on Windows", () => {
  expect(allowed("win32", "ps", "")).toBe(false);
});

describe.runIf(process.platform !== "win32")("systemOwned", () => {
  it("takes the system's ps and refuses a file the person owns", () => {
    expect(
      systemOwned(process.platform === "darwin" ? "/bin/ps" : "/usr/bin/ps"),
    ).toBe(true);
    expect(systemOwned(import.meta.filename)).toBe(false);
  });
});

describe("classifyProcessList for tasklist", () => {
  const tasklist = (argv: string[], platform: NodeJS.Platform = "win32") =>
    classifyProcessList("tasklist", argv, platform).allowed;

  it.each([
    [[]],
    [["/fo", "csv", "/nh"]],
    [["/V", "/FO", "LIST"]],
    [["-v"]],
    [["/fi", "IMAGENAME eq node.exe", "/fi", "STATUS eq running"]],
    [["/svc"]],
    [["/m"]],
    [["/m", "ntdll.dll", "/fo", "table"]],
    [["/m", "/nh"]],
    [["/apps"]],
    [["/?"]],
  ])("tasklist %j runs", (argv) => {
    expect(tasklist(argv)).toBe(true);
  });

  it.each([
    [["/s", "x"]],
    [["/S", "server", "/u", "me", "/p", "secret"]],
    [["/u", "me"]],
    [["/p"]],
    [["/fo", "xml"]],
    [["/fo"]],
    [["/fi"]],
    [["node.exe"]],
    [["/fo:csv"]],
  ])("tasklist %j is refused", (argv) => {
    expect(tasklist(argv)).toBe(false);
  });

  it("is only on Windows", () => {
    expect(tasklist([], "darwin")).toBe(false);
  });

  it("names what it refused and what it takes", () => {
    expect(classifyProcessList("tasklist", ["/s", "x"], "win32"))
      .toMatchInlineSnapshot(`
      {
        "allowed": false,
        "reason": "tasklist: \`/s\` can't be used here. \`tasklist\` takes the options that list this computer's processes: /v, /svc, /m [module], /apps, /fi "<filter>", /fo table|list|csv, /nh; not /s, /u or /p.",
      }
    `);
  });
});

describe("systemOwned on Windows", () => {
  const owned = (file: string) =>
    systemOwned(file, { platform: "win32", systemRoot: "C:\\Windows" });

  it("takes a program in System32 and nothing else", () => {
    expect(owned("C:\\Windows\\System32\\tasklist.exe")).toBe(true);
    expect(owned("c:\\windows\\system32\\TASKLIST.EXE")).toBe(true);
    expect(owned("C:\\Windows\\System32\\sub\\tasklist.exe")).toBe(false);
    expect(owned("C:\\Users\\sam\\tasklist.exe")).toBe(false);
    expect(owned("C:\\Windows\\System32\\..\\Temp\\tasklist.exe")).toBe(false);
  });
});
