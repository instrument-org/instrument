import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  classifyUnsandboxed,
  REVIEWED,
  UNSANDBOXED_RULES,
} from "./unsandboxed-uutils";

/** A command line as the classifier reads it: the name, then its arguments. */
function classify(line: string) {
  const [name = "", ...argv] = line.split(" ");
  return classifyUnsandboxed(name, argv);
}

describe("classifyUnsandboxed", () => {
  it.each([
    "head -n 5",
    "head -5",
    "head -qn5 -",
    "head -v",
    "tail -n +3",
    "tail -c 10",
    "tail -20",
    "sort -rn",
    "sort -t , -k2,2n",
    "sort -t, -k 2 -u",
    "sort --key=2 --field-separator=,",
    "uniq -c",
    "uniq -D",
    "uniq --all-repeated=separate",
    "cut -d : -f 1",
    "cut -c1-5 --complement",
    "wc -l",
    "wc",
    "wc -lw",
    "grep -c foo",
    "grep -e foo",
    "grep -e foo -e bar",
    "grep --color=never -in foo",
    "grep -A 2 foo -",
    "date +%Y-%m-%d",
    "date -u +%s",
    "date -d tomorrow +%F",
    "date -I",
    "date --iso-8601=seconds",
    "seq 1 10",
    "seq -1 5",
    "seq -s , -w 3",
    "factor 12",
    "uname -a",
    "nproc --all",
    "numfmt --to=iec 2048",
    "id -u",
    "sha256sum",
    "md5sum -b",
    "cksum",
    "shuf -e a b c",
    "shuf -i 1-10 -n 3",
    "od -An -tx1",
    "base32 -d",
    "fmt -w 60",
  ])("%s runs outside the sandbox naming no file", (line) => {
    expect(classify(line)).toEqual({ tier: "A" });
  });

  it.each([
    "head -n 1 notes.txt",
    "head -1 notes.txt",
    "tail -n +2 -- notes.txt",
    "sort -u notes.txt",
    "uniq -c notes.txt",
    "cut -d , -f 2 notes.txt",
    "wc -l notes.txt",
    "wc --lines notes.txt",
    "grep -n foo notes.txt",
    "grep -H foo -- notes.txt",
    "grep -l -- -foo notes.txt",
    "od -c notes.txt",
    "base32 notes.txt",
    "fmt notes.txt",
    "shuf notes.txt",
  ])("%s reads its one file on stdin", (line) => {
    expect(classify(line)).toMatchObject({
      operand: line.split(" ").at(-1),
      tier: "B",
    });
  });

  it("names grep's input with --label ahead of everything", () => {
    expect(classify("grep -H foo -- notes.txt")).toMatchInlineSnapshot(`
      {
        "argv": [
          "--label=notes.txt",
          "-H",
          "foo",
          "--",
        ],
        "fixup": "grepLabel",
        "operand": "notes.txt",
        "tier": "B",
      }
    `);
    expect(classify("wc -l notes.txt")).toMatchInlineSnapshot(`
      {
        "argv": [
          "-l",
        ],
        "fixup": "wcAppendName",
        "operand": "notes.txt",
        "tier": "B",
      }
    `);
  });

  it.each([
    // clap takes any unambiguous prefix of a long option.
    "wc --files0=list",
    "wc --files0-from=list",
    "sort --out=x",
    "sort --comp=gzip",
    "sort --compress-program=gzip",
    "sort --random-source=/dev/urandom",
    "sort --files0-from=list",
    "sort -ro/x",
    "sort -o x",
    "sort -T/x",
    "sort -m a b",
    "sort -c notes.txt",
    "sort +1 notes.txt",
    "head --line=3",
    // Every positional after -e is a file.
    "grep -e x f",
    "grep -f patterns",
    "grep -d recurse x",
    "grep --directories=recurse x",
    "grep -r x",
    "grep -R x .",
    "grep --include=*.md x",
    "grep --exclude-from=list x",
    "grep --label=x foo f",
    "grep -5 x f",
    "grep -nT foo notes.txt",
    "uniq a b",
    "uniq -Dc",
    "sha256sum -c",
    "sha256sum --check sums",
    "sha256sum notes.txt",
    "date -r f",
    "date --reference=f",
    "date -f dates",
    "date -s 12:00",
    "date 0101",
    "date -I +%s",
    "wc -lw f",
    "wc f",
    "head -v f",
    "head -n 1 a b",
    "head -f f",
    "head notes.txt -5",
    "tail -f f",
    "tail -F f",
    "tail --pid=1 f",
    "tail +5 f",
    "cut -d , -f 1 a b",
    "shuf -o out",
    "shuf --random-source=f",
    "shuf -i 1-3 x",
    "od -w 8 f",
    "id root",
    "cksum f",
    "stat f",
    "realpath x",
    "find .",
    "xargs echo",
    "dd if=f",
  ])("%s stays in the sandbox", (line) => {
    expect(classify(line)).toEqual({ tier: "sandbox" });
  });

  it("reads clap's short clusters: a value letter takes the rest", () => {
    // `-k2n` is one key; `-rk` takes the next argument as its key.
    expect(classifyUnsandboxed("sort", ["-rk", "2"])).toEqual({ tier: "A" });
    expect(classifyUnsandboxed("sort", ["-k2n", "-o"])).toEqual({
      tier: "sandbox",
    });
    // A value that looks like an option is still the value.
    expect(classifyUnsandboxed("cut", ["-d", "-o", "-f1"])).toEqual({
      tier: "A",
    });
  });

  it("leaves an empty operand to the sandbox", () => {
    expect(classifyUnsandboxed("head", [""])).toEqual({ tier: "sandbox" });
  });

  it("knows only the routes it reviewed", () => {
    expect(Object.keys(UNSANDBOXED_RULES).toSorted()).toMatchInlineSnapshot(`
      [
        "arch",
        "b2sum",
        "base32",
        "basenc",
        "cksum",
        "cut",
        "date",
        "factor",
        "fmt",
        "grep",
        "head",
        "id",
        "md5sum",
        "nproc",
        "numfmt",
        "od",
        "seq",
        "sha224sum",
        "sha256sum",
        "sha384sum",
        "sha512sum",
        "shuf",
        "sort",
        "tail",
        "uname",
        "uniq",
        "wc",
      ]
    `);
  });
});

describe("REVIEWED", () => {
  /**
   * The rules were read against one uutils release's sources. A download
   * script that pins anything else (a release, an upstream version, an
   * archive or binary hash) fails here until someone reads the sources of
   * the new one against `UNSANDBOXED_RULES` and updates `REVIEWED`.
   */
  it("matches the release download-uutils.ts vendors (else re-review the allowlist)", () => {
    const script = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../../apps/studio/scripts/download-uutils.ts",
      ),
      "utf8",
    );
    const pinned = {
      hashes: [...script.matchAll(/\b[0-9a-f]{64}\b/g)]
        .map(([hash]) => hash)
        .toSorted(),
      release: /const RELEASE = "([^"]+)"/.exec(script)?.[1],
      upstream: Object.fromEntries(
        [
          ...(/const UPSTREAM = \{([^}]*)\}/.exec(script)?.[1] ?? "").matchAll(
            /(\w+): "([^"]+)"/g,
          ),
        ].map(([, project = "", version = ""]) => [project, version]),
      ),
    };
    const reviewed = {
      hashes: Object.values(REVIEWED.targets)
        .flatMap((target) => [target.archive, ...Object.values(target.files)])
        .toSorted(),
      release: REVIEWED.release,
      upstream: REVIEWED.upstream,
    };
    expect(pinned, "re-review allowlist").toEqual(reviewed);
  });
});
