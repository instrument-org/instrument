import { CHAT_FOLDER_NAMES } from "../../constants";

/**
 * tar's short options that take a value, in the tar each platform carries:
 * GNU tar on Linux, bsdtar on macOS and Windows. They disagree on `-L`,
 * which takes a value only in GNU's.
 */
function valueFlags(platform: NodeJS.Platform) {
  return platform === "linux" ? "bCfFgHIKLNTVX" : "bCfIsTX";
}

/** The mode letters, and what each long mode option means. */
const MODES = "Acdrtux";
const LONG_MODES: Record<string, string> = {
  "--append": "r",
  "--catenate": "A",
  "--concatenate": "A",
  "--create": "c",
  "--delete": "d",
  "--diff": "d",
  "--extract": "x",
  "--get": "x",
  "--list": "t",
  "--update": "u",
};

/**
 * tar's arguments with an old-style first argument (`czf out.tgz dir`,
 * no dash) spelled as the separate options it stands for (`-c -z -f
 * out.tgz dir`), each value letter taking the next argument in turn, as GNU
 * tar reads one. Everything else is left as it is.
 */
export function tarWithDashedOptions(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const [first, ...rest] = args;
  if (first === undefined || !/^[A-Za-z]+$/.test(first)) {
    return args;
  }
  const values = valueFlags(platform);
  const out: string[] = [];
  let next = 0;
  for (const letter of first) {
    out.push(`-${letter}`);
    if (values.includes(letter) && next < rest.length) {
      out.push(rest[next] ?? "");
      next += 1;
    }
  }
  return [...out, ...rest.slice(next)];
}

/**
 * What a tar command line asks for: its mode, the archive it names (`-f`)
 * and the folders it changes into (`-C`). Read from dashed options only, so
 * an old-style first argument goes through tarWithDashedOptions first.
 */
function tarOptions(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { archives: string[]; folders: string[]; mode: string | undefined } {
  const values = valueFlags(platform);
  const archives: string[] = [];
  const folders: string[] = [];
  let mode: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      break;
    }
    if (arg.startsWith("--")) {
      const [name = "", inline] = arg.split(/=(.*)/s);
      mode = LONG_MODES[name] ?? mode;
      if (name === "--file" || name === "--directory") {
        const value = inline ?? args[index + 1];
        if (inline === undefined) {
          index += 1;
        }
        if (value !== undefined) {
          (name === "--file" ? archives : folders).push(value);
        }
      }
      continue;
    }
    if (!/^-./.test(arg)) {
      continue;
    }
    for (let at = 1; at < arg.length; at++) {
      const letter = arg.charAt(at);
      if (MODES.includes(letter)) {
        mode = letter;
      }
      if (values.includes(letter)) {
        // The rest of the cluster is its value, or else the next argument.
        let value = arg.slice(at + 1);
        if (value === "") {
          index += 1;
          value = args[index] ?? "";
        }
        if (letter === "f") {
          archives.push(value);
        } else if (letter === "C") {
          folders.push(value);
        }
        break;
      }
    }
  }
  return { archives, folders, mode };
}

/**
 * What a tar command writes: the archive it creates or adds to, or the
 * folder it extracts into, the working directory when it names none. `-`
 * is stdout or stdin, not a path.
 */
export function tarWrites(args: string[]): string[] {
  const { archives, folders, mode } = tarOptions(tarWithDashedOptions(args));
  if (mode === "x") {
    return folders.length > 0 ? folders : ["."];
  }
  return mode !== undefined && "Acru".includes(mode)
    ? archives.filter((archive) => archive !== "-")
    : [];
}

/**
 * Writes the archive it makes to stdout (`-f -`, or no `-f` at all). A
 * native command's output reaches the shell as text, which would garble the
 * archive's bytes, so the builtin makes that one.
 */
export function tarWritesStdout(args: string[]): boolean {
  const { archives, mode } = tarOptions(tarWithDashedOptions(args));
  return (
    mode !== undefined &&
    "Acru".includes(mode) &&
    (archives.length === 0 || archives.includes("-"))
  );
}

/**
 * tar's arguments as the system tar gets them: old-style options dashed,
 * and every `.instrument` folder left out of what it archives or extracts,
 * as the shell's own commands never show it. Both GNU tar and bsdtar match
 * an `--exclude` pattern at any depth, and read it before the mode.
 */
export function tarProgramArgs(args: string[]): string[] {
  const dashed = tarWithDashedOptions(args);
  const { mode } = tarOptions(dashed);
  return mode !== undefined && "Acrux".includes(mode)
    ? [`--exclude=${CHAT_FOLDER_NAMES.private}`, ...dashed]
    : dashed;
}
