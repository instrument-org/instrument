/**
 * Which calls of the bundled uutils may run without the OS sandbox.
 *
 * Starting a program under Seatbelt, bubblewrap or MXC costs from a few
 * milliseconds to tens of them, and a loop of `head -1 "$f"` or a pipeline
 * ending in `| head` pays it for every program it starts. A uutils program
 * given no path can reach the disk only through its environment, its own
 * files, or an option that names a file, so a call whose options are all on
 * the reviewed list below and that names no file needs no sandbox (tier A).
 * A call that names exactly one file can have the shell open that file,
 * after checking it, and hand the program the open file as its stdin, so the
 * program still opens nothing (tier B). Everything else runs sandboxed as
 * before.
 *
 * The rules are a closed list read against the sources of the release in
 * `REVIEWED`. clap, which parses every one of these programs' arguments,
 * takes any unambiguous prefix of a long option (`--files0` is
 * `--files0-from`), so only the exact spellings here are accepted, and
 * anything else goes to the sandbox.
 */

/** How an option takes its value. */
type Takes =
  /** No value: `-c`, `--count`. */
  | "nothing"
  /** The rest of the short cluster or the next argument; `--long=v` or `--long v`. */
  | "value"
  /** Only joined with `=` (`--color=never`); never the next argument. */
  | "joined"
  /**
   * Joined, or else the next argument when that does not start with `-`
   * (clap's optional value without `require_equals`). A call that leaves
   * the next argument to clap's guess is sandboxed.
   */
  | "maybeNext";

interface UutilsOption {
  /** What `notInB`, `oneOf` and `switches` name it by. */
  id: string;
  long: readonly string[];
  short: string;
  takes: Takes;
}

/** What a command's positional arguments are. */
type Positionals =
  /** Each one a file the program opens (`-` is stdin). */
  | "files"
  /** grep's: the pattern, then files. */
  | "patternThenFiles"
  /** Never paths: numbers, words. */
  | "values"
  /** date's: each one a `+FORMAT`. */
  | "formats"
  /** Any positional at all sends the call to the sandbox. */
  | "none";

/** How a tier B call's output is made the same as with the file named. */
export type TierBFixup =
  /** Nothing the program prints names its input. */
  | "asStdin"
  /** grep names its input by `--label`: `-H`, `-l`, "Binary file x matches". */
  | "grepLabel"
  /** wc with one count prints ` <name>` after it for a file, nothing for stdin. */
  | "wcAppendName";

interface UutilsRule {
  /**
   * Every option the program has is harmless with any value: none names a
   * path, so the call needs no parsing beyond its positionals.
   */
  anyOption?: true;
  /** `-NUM` as the first argument: head's and tail's obsolete count. */
  leadingCount?: true;
  /** Options that rule out tier B, because they print the input's name. */
  notInB?: readonly string[];
  /** Tier B only with exactly one of these (wc's counts). */
  oneOf?: readonly string[];
  options: readonly UutilsOption[];
  positionals: Positionals;
  /** Options that change what the positionals are (`grep -e`, `shuf -e`). */
  switches?: readonly { ids: readonly string[]; positionals: Positionals }[];
  tierB?: TierBFixup;
}

/** An option with a short letter (or none, `""`) and its long spellings. */
function opt(
  short: string,
  long: string | readonly string[],
  takes: Takes = "nothing",
): UutilsOption {
  const longs = typeof long === "string" ? [long] : long;
  return { id: longs[0] ?? short, long: longs, short, takes };
}

const SUM_OPTIONS = [opt("b", "binary"), opt("t", "text")];

const BASE_OPTIONS = [
  opt("d", "decode"),
  opt("D", []),
  opt("i", "ignore-garbage"),
  opt("w", "wrap", "value"),
];

const HEAD_TAIL: UutilsRule = {
  leadingCount: true,
  notInB: ["verbose"],
  options: [
    opt("c", "bytes", "value"),
    opt("n", "lines", "value"),
    opt("q", ["quiet", "silent"]),
    opt("v", "verbose"),
    opt("z", "zero-terminated"),
  ],
  positionals: "files",
  tierB: "asStdin",
};

const ANY_VALUES: UutilsRule = {
  anyOption: true,
  options: [],
  positionals: "values",
};

/**
 * The reviewed rules, by command name. A command not here always runs
 * sandboxed: `cmp`, `comm`, `join`, `tsort` and `pr` take two files or print
 * the name; `dd`, `stat`, `realpath`, `readlink` and `df` reach paths
 * through operands or metadata; `split` writes files; `find`, `xargs` walk
 * and start programs; `paste`, `nl`, `fold`, `tac`, `expand` and `unexpand`
 * have not been read against the sources yet.
 */
export const UNSANDBOXED_RULES: Readonly<Record<string, UutilsRule>> = {
  arch: ANY_VALUES,
  b2sum: { options: SUM_OPTIONS, positionals: "none" },
  base32: { options: BASE_OPTIONS, positionals: "files", tierB: "asStdin" },
  // base32's parser and reader (base_common) with another alphabet.
  base64: { options: BASE_OPTIONS, positionals: "files", tierB: "asStdin" },
  // Takes its operands apart as strings and opens nothing.
  basename: ANY_VALUES,
  basenc: {
    options: [
      ...BASE_OPTIONS,
      ...[
        "base64",
        "base64url",
        "base32",
        "base32hex",
        "base16",
        "base2lsbf",
        "base2msbf",
        "z85",
        "base58",
      ].map((name) => opt("", name)),
    ],
    positionals: "files",
    tierB: "asStdin",
  },
  // cksum names each file it reads, and its options pick algorithms whose
  // output differs; with none it hashes stdin.
  cksum: { options: [], positionals: "none" },
  cut: {
    options: [
      opt("b", "bytes", "value"),
      opt("c", "characters", "value"),
      opt("d", "delimiter", "value"),
      opt("f", "fields", "value"),
      opt("n", []),
      opt("s", "only-delimited"),
      opt("z", "zero-terminated"),
      opt("", "complement"),
      opt("", "output-delimiter", "value"),
    ],
    positionals: "files",
    tierB: "asStdin",
  },
  // Takes its operands apart as strings and opens nothing.
  dirname: ANY_VALUES,
  // `-f`/`--file` and `-r`/`--reference` read a file and `-s` sets the
  // clock; a positional that is not `+FORMAT` is a date to set.
  date: {
    options: [
      opt("d", "date", "value"),
      opt("I", "iso-8601", "maybeNext"),
      opt("R", ["rfc-email", "rfc-2822", "rfc-822"]),
      opt("u", ["universal", "utc", "uct"]),
      opt("", "rfc-3339", "value"),
    ],
    positionals: "formats",
  },
  factor: ANY_VALUES,
  fmt: {
    options: [
      opt("c", "crown-margin"),
      opt("t", "tagged-paragraph"),
      opt("s", "split-only"),
      opt("u", "uniform-spacing"),
      opt("w", "width", "value"),
      opt("g", "goal", "value"),
    ],
    positionals: "files",
    tierB: "asStdin",
  },
  grep: {
    // -T pads line numbers to the file's size for a file and to a fixed
    // width for stdin.
    notInB: ["initial-tab"],
    options: [
      opt("E", "extended-regexp"),
      opt("F", "fixed-strings"),
      opt("G", "basic-regexp"),
      opt("P", "perl-regexp"),
      opt("i", "ignore-case"),
      opt("y", []),
      opt("", "no-ignore-case"),
      opt("w", "word-regexp"),
      opt("x", "line-regexp"),
      opt("z", "null-data"),
      opt("s", "no-messages"),
      opt("v", "invert-match"),
      opt("b", "byte-offset"),
      opt("n", "line-number"),
      opt("", "line-buffered"),
      opt("H", "with-filename"),
      opt("h", "no-filename"),
      opt("o", "only-matching"),
      opt("q", ["quiet", "silent"]),
      opt("a", "text"),
      opt("I", []),
      opt("l", "files-with-matches"),
      opt("L", "files-without-match"),
      opt("c", "count"),
      opt("T", "initial-tab"),
      opt("Z", "null"),
      opt("U", "binary"),
      opt("", "no-group-separator"),
      opt("m", "max-count", "value"),
      opt("A", "after-context", "value"),
      opt("B", "before-context", "value"),
      opt("C", "context", "value"),
      opt("", "group-separator", "value"),
      opt("", "binary-files", "value"),
      opt("e", "regexp", "value"),
      opt("", ["color", "color"], "joined"),
    ],
    positionals: "patternThenFiles",
    // With -e every positional is a file, which tier B would need the
    // pattern positional to tell apart.
    switches: [{ ids: ["regexp"], positionals: "none" }],
    tierB: "grepLabel",
  },
  head: HEAD_TAIL,
  // `id USER` reads the user database, as it does sandboxed, but stays
  // there with the rest of what this list leaves out.
  id: { anyOption: true, options: [], positionals: "none" },
  md5sum: { options: SUM_OPTIONS, positionals: "none" },
  nproc: ANY_VALUES,
  numfmt: ANY_VALUES,
  od: {
    options: [
      opt("A", "address-radix", "value"),
      opt("j", "skip-bytes", "value"),
      opt("N", "read-bytes", "value"),
      opt("t", "format", "value"),
      ..."abcdDoILilxhOsXHefF".split("").map((short) => opt(short, [])),
      opt("v", "output-duplicates"),
      opt("", "endian", "value"),
    ],
    positionals: "files",
    tierB: "asStdin",
  },
  seq: ANY_VALUES,
  // The same checksum front end as sha256sum (uu_checksum_common).
  sha1sum: { options: SUM_OPTIONS, positionals: "none" },
  sha224sum: { options: SUM_OPTIONS, positionals: "none" },
  sha256sum: { options: SUM_OPTIONS, positionals: "none" },
  sha384sum: { options: SUM_OPTIONS, positionals: "none" },
  sha512sum: { options: SUM_OPTIONS, positionals: "none" },
  shuf: {
    options: [
      opt("e", "echo"),
      opt("i", "input-range", "value"),
      opt("n", "head-count", "value"),
      opt("r", "repeat"),
      opt("z", "zero-terminated"),
      opt("", "random-seed", "value"),
    ],
    positionals: "files",
    switches: [
      { ids: ["echo"], positionals: "values" },
      { ids: ["input-range"], positionals: "none" },
    ],
    tierB: "asStdin",
  },
  // Past its buffer sort spills to TMPDIR, which the environment pins
  // (unsandboxed-uutils-env.ts).
  sort: {
    options: [
      ...[
        ["b", "ignore-leading-blanks"],
        ["d", "dictionary-order"],
        ["f", "ignore-case"],
        ["g", "general-numeric-sort"],
        ["h", "human-numeric-sort"],
        ["i", "ignore-nonprinting"],
        ["M", "month-sort"],
        ["n", "numeric-sort"],
        ["R", "random-sort"],
        ["r", "reverse"],
        ["s", "stable"],
        ["u", "unique"],
        ["V", "version-sort"],
        ["z", "zero-terminated"],
      ].map(([short = "", long = ""]) => opt(short, long)),
      opt("k", "key", "value"),
      opt("t", "field-separator", "value"),
    ],
    positionals: "files",
    tierB: "asStdin",
  },
  tail: HEAD_TAIL,
  uname: ANY_VALUES,
  // A second operand is the file uniq writes.
  uniq: {
    options: [
      opt("c", "count"),
      opt("d", "repeated"),
      opt("D", "all-repeated", "joined"),
      opt("i", "ignore-case"),
      opt("u", "unique"),
      opt("z", "zero-terminated"),
      opt("f", "skip-fields", "value"),
      opt("s", "skip-chars", "value"),
      opt("w", "check-chars", "value"),
      opt("", "group", "joined"),
    ],
    positionals: "files",
    tierB: "asStdin",
  },
  // With two or more counts the column width comes from the file's size.
  wc: {
    oneOf: ["bytes", "chars", "lines", "max-line-length", "words"],
    options: [
      opt("c", "bytes"),
      opt("m", "chars"),
      opt("l", "lines"),
      opt("L", "max-line-length"),
      opt("w", "words"),
    ],
    positionals: "files",
    tierB: "wcAppendName",
  },
};

/** Where a call runs, and for tier B what the shell hands it. */
export type UnsandboxedTier =
  | { tier: "A" }
  | {
      /** The program's arguments without the file, with any fix-up added. */
      argv: string[];
      fixup: TierBFixup;
      /** The file, as the call names it. */
      operand: string;
      tier: "B";
    }
  | { tier: "sandbox" };

const SANDBOX = { tier: "sandbox" } as const;

/**
 * Where `name` with `argv` (its arguments, without the program name) may
 * run: without the sandbox naming no file (A), without it reading one file
 * the shell opened (B), or sandboxed. Pure: it reads only its arguments.
 */
export function classifyUnsandboxed(
  name: string,
  argv: readonly string[],
): UnsandboxedTier {
  const rule = UNSANDBOXED_RULES[name];
  if (rule === undefined) {
    return SANDBOX;
  }
  const seen = new Set<string>();
  const positionals: { arg: string; index: number }[] = [];
  let onlyOperands = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (onlyOperands || arg === "-" || !arg.startsWith("-")) {
      positionals.push({ arg, index });
      continue;
    }
    if (arg === "--") {
      onlyOperands = true;
      continue;
    }
    if (rule.anyOption) {
      continue;
    }
    if (index === 0 && rule.leadingCount && /^-\d+$/.test(arg)) {
      continue;
    }
    const step = arg.startsWith("--")
      ? readLong(rule, arg, argv[index + 1])
      : readShortCluster(rule, arg, argv[index + 1]);
    if (step === undefined) {
      return SANDBOX;
    }
    for (const id of step.ids) {
      seen.add(id);
    }
    index += step.consumed;
  }
  if (rule.anyOption && rule.positionals === "values") {
    return { tier: "A" };
  }
  const kind =
    rule.switches?.find((each) => each.ids.some((id) => seen.has(id)))
      ?.positionals ?? rule.positionals;
  switch (kind) {
    case "values":
      return { tier: "A" };
    case "formats":
      return positionals.every(({ arg }) => arg.startsWith("+"))
        ? { tier: "A" }
        : SANDBOX;
    case "none":
      return positionals.length === 0 ? { tier: "A" } : SANDBOX;
    case "files":
    case "patternThenFiles": {
      const files = kind === "files" ? positionals : positionals.slice(1);
      // A leading `+` is an obsolete key or offset to sort, tail and od,
      // read differently by each.
      if (files.some(({ arg }) => arg.startsWith("+"))) {
        return SANDBOX;
      }
      const named = files.filter(({ arg }) => arg !== "-");
      if (named.length === 0) {
        return { tier: "A" };
      }
      const only = named[0];
      if (
        files.length !== 1 ||
        only === undefined ||
        only.arg === "" ||
        rule.tierB === undefined ||
        // wc quotes a name holding a newline.
        (rule.tierB === "wcAppendName" && only.arg.includes("\n")) ||
        rule.notInB?.some((id) => seen.has(id)) === true ||
        (rule.oneOf !== undefined &&
          rule.oneOf.filter((id) => seen.has(id)).length !== 1)
      ) {
        return SANDBOX;
      }
      const rest = argv.filter((_, index) => index !== only.index);
      return {
        argv:
          rule.tierB === "grepLabel" ? [`--label=${only.arg}`, ...rest] : rest,
        fixup: rule.tierB,
        operand: only.arg,
        tier: "B",
      };
    }
  }
}

/** What one option argument named, and how many arguments after it it took. */
type Step = { consumed: number; ids: string[] };

function readLong(
  rule: UutilsRule,
  arg: string,
  next: string | undefined,
): Step | undefined {
  const eq = arg.indexOf("=");
  const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
  const option = rule.options.find((each) => each.long.includes(name));
  if (option === undefined) {
    return undefined;
  }
  const ids = [option.id];
  switch (option.takes) {
    case "nothing":
      return eq === -1 ? { consumed: 0, ids } : undefined;
    case "value":
      if (eq !== -1) {
        return { consumed: 0, ids };
      }
      return next === undefined ? undefined : { consumed: 1, ids };
    case "joined":
      return { consumed: 0, ids };
    case "maybeNext":
      return eq === -1 && next !== undefined && !next.startsWith("-")
        ? undefined
        : { consumed: 0, ids };
  }
}

/**
 * A cluster of short options the way clap reads one: letters that take no
 * value, until one that takes the rest of the cluster or else the next
 * argument.
 */
function readShortCluster(
  rule: UutilsRule,
  arg: string,
  next: string | undefined,
): Step | undefined {
  const ids: string[] = [];
  for (let at = 1; at < arg.length; at++) {
    const letter = arg.charAt(at);
    const option = rule.options.find((each) => each.short === letter);
    if (option === undefined || letter === "") {
      return undefined;
    }
    ids.push(option.id);
    const last = at === arg.length - 1;
    switch (option.takes) {
      case "nothing":
        continue;
      case "value":
        if (!last) {
          return { consumed: 0, ids };
        }
        return next === undefined ? undefined : { consumed: 1, ids };
      case "joined":
        if (last) {
          continue;
        }
        return arg.charAt(at + 1) === "=" ? { consumed: 0, ids } : undefined;
      case "maybeNext":
        if (!last) {
          return arg.charAt(at + 1) === "=" ? { consumed: 0, ids } : undefined;
        }
        return next !== undefined && !next.startsWith("-")
          ? undefined
          : { consumed: 0, ids };
    }
  }
  return { consumed: 0, ids };
}

/**
 * The uutils build these rules were read against: the
 * instrument-org/uutils-build release, the upstream versions it was built
 * from, and each target's archive and binaries by sha256. The binaries'
 * hashes are also what a binary is checked against before it runs outside
 * the sandbox (`unsandboxed-uutils-integrity.ts`). A test holds them equal
 * to `apps/studio/scripts/download-uutils.ts`, so a new release fails until
 * the rules are read again against its sources.
 */
export const REVIEWED = {
  release: "2026.10.15",
  targets: {
    "darwin-arm64": {
      archive:
        "32097a0ba9c21af3b9da4de6a36f22278893f42cd0212c537596e72734dac08d",
      files: {
        coreutils:
          "14b6e2df87094f7e8e1044d31bae70e232d9bb4a9abd6eadb8bcb236f0808594",
        grep: "1deb0d7185f5d0fc045e408cae914bf9e33b0e83418a88bc2863f76219b7a28d",
      },
    },
    "darwin-x64": {
      archive:
        "0d79cd8ac74fb842a77beeb99b54080bc6dc3488d23fe199c96be91a7e8b92ba",
      files: {
        coreutils:
          "11e57c189c8762efcb434d94fa1be4b2559f37d9d5d36fdba99a1745192eae4b",
        grep: "4599ebb8a63c1504ce9957bcdb7d1d6a46f21e5950be3604916a636f23005fbc",
      },
    },
    "linux-arm64": {
      archive:
        "93e26ee03055e9ed291b739a606a733a68f29b2e1d0a12d9df445d244b2dc9d5",
      files: {
        coreutils:
          "b46e3148cd36a8191f029d1dd28d52d85de7d4b55fc4378a031e5387f3a510ee",
        grep: "3692cc5da8565f9df971bffea1b3511187b0575af396cc8cf7c6411f30dcb6e1",
      },
    },
    "linux-x64": {
      archive:
        "a98be7c295283bf443891daa7cd88149b66f3cdc544eb46e67a90c7633f3b295",
      files: {
        coreutils:
          "46eb370af3f8d28880827e9b9f6f38904d495d6c151509d6f7ed56cd67352840",
        grep: "3ea6e8a36171f6083d916e7aaebb9dfb66e218d09abf00567d9eb9f7746982ca",
      },
    },
    "win32-arm64": {
      archive:
        "a60497f6e9e78cbba3479a676c54df59d12d8dfc4027515990d82aa4fa307a4b",
      files: {
        coreutils:
          "ee5071e05303e4f78adc098190da32b82f5128f59bb1b22f620bb264c54d4dc8",
        grep: "9c51786ef7cbf192f1d33c0343c9dccec0fa63288832672a18970904804e27f5",
      },
    },
    "win32-x64": {
      archive:
        "77812ad386bbe9175a9f9da6e529c3c86ee5ee110f005361426a0f1bc21727d5",
      files: {
        coreutils:
          "3510f3cca330adc1a5e37687678960de73d861366dd28843493d81c43eed3c65",
        grep: "5278dc3486436c7999277f1945c643fcacddc6cb7f24a07d8f98c115705a22eb",
      },
    },
  },
  upstream: {
    coreutils: "0.12.0",
    diffutils: "0.5.0",
    findutils: "0.10.0",
    grep: "0.2.0",
  },
} as const;
