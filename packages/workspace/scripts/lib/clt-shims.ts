import fs from "node:fs/promises";
import path from "node:path";

import { isCommandLineToolsStub } from "../../src/lib/command-line-tools-env";

/**
 * The `/usr/bin` tools macOS ships as xcode-select stubs. Each one hands itself
 * to libxcselect's `xcselect_invoke_xcrun`, which resolves the active developer
 * directory before doing anything else; when no developer directory can be
 * found it asks the system to install the Command Line Tools, which puts a
 * modal dialog on screen and blocks the caller until someone answers it.
 *
 * Apple documents most of these under FILES in `man xcode-select`, but the man
 * page list is incomplete (`cc`, `c++`, `objdump`, and others are stubs too),
 * so this is the scan of a real machine (macOS 27). `scanCommandLineToolsShims`
 * re-derives it from the running OS with the product's own test,
 * `isCommandLineToolsStub`. Other tools link libxcselect only to look the
 * directory up (`atos`, `heap`, `leaks`, `kmutil`, `vmmap`) and run without
 * the tools, so they are not stubs and are not listed.
 */
// Apple's tool names, spelled Apple's way. Listing each one as a dictionary
// entry would be longer than the array.
export const CLT_SHIM_NAMES = [
  "DeRez",
  "GetFileInfo",
  "ResMerger",
  "Rez",
  "SetFile",
  "SplitForks",
  "actool",
  "agvtool",
  "ar",
  "as",
  "asa",
  "bison",
  "bm4",
  "c++",
  "c++filt",
  "c89",
  "c99",
  "cc",
  "clang",
  "clang++",
  "clangd",
  "cmpdylib",
  "codesign_allocate",
  "cpp",
  "ctags",
  "ctf_insert",
  "desdp",
  "dsymutil",
  "dwarfdump",
  "dyld_info",
  "flex",
  "flex++",
  "g++",
  "gatherheaderdoc",
  "gcc",
  "gcov",
  "genstrings",
  "git",
  "git-receive-pack",
  "git-shell",
  "git-upload-archive",
  "git-upload-pack",
  "gm4",
  "gnumake",
  "gperf",
  "hdxml2manxml",
  "headerdoc2html",
  "ibtool",
  "ictool",
  "indent",
  "install_name_tool",
  "ld",
  "lex",
  "libtool",
  "lipo",
  "lldb",
  "llvm-g++",
  "llvm-gcc",
  "lorder",
  "m4",
  "make",
  "mig",
  "nm",
  "nmedit",
  "objdump",
  "opendiff",
  "otool",
  "pagestuff",
  "pip3",
  "python3",
  "ranlib",
  "resolveLinks",
  "rpcgen",
  "sdef",
  "sdp",
  "segedit",
  "size",
  "sourcekit-lsp",
  "stapler",
  "strings",
  "strip",
  "swift",
  "swiftc",
  "unifdef",
  "unifdefall",
  "vtool",
  "xcdebug",
  "xcode-select",
  "xcodebuild",
  "xcrun",
  "xcscontrol",
  "xcsdiagnose",
  "xctrace",
  "xed",
  "xml2man",
  "yacc",
] as const;

/**
 * `xcode-select -p` reads the configured developer directory and reports its
 * absence as an ordinary error, so it is the one stub that is safe to run: it
 * is how you probe for the tools without asking for them. Every other stub,
 * `xcrun` included, takes the install-on-demand path.
 */
export const SAFE_SHIM_INVOCATIONS: Record<string, readonly string[]> = {
  "xcode-select": ["-p", "--print-path"],
};

const SHIM_DIR = "/usr/bin";

/**
 * Where the committed list and the running OS part: stubs this host ships
 * that {@link CLT_SHIM_NAMES} does not list, and listed names the product's
 * test does not take for a stub here. Either way the list or the test needs
 * another look before the next release ships.
 */
export async function compareHostShims(): Promise<{
  notStubs: string[];
  unlisted: string[];
}> {
  const known = new Set<string>(CLT_SHIM_NAMES);
  const onHost = new Set(await scanCommandLineToolsShims());
  return {
    // xcode-select is listed so the audit logs the product's own probe; it
    // is the tool that answers for the directory, not a stub handing off.
    notStubs: CLT_SHIM_NAMES.filter(
      (name) => !onHost.has(name) && SAFE_SHIM_INVOCATIONS[name] === undefined,
    ),
    unlisted: [...onHost].filter((name) => !known.has(name)),
  };
}

/**
 * Names in {@link SHIM_DIR} the product takes for a stub, read off the
 * running OS. Used to keep {@link CLT_SHIM_NAMES} honest across macOS releases.
 */
async function scanCommandLineToolsShims(): Promise<string[]> {
  if (process.platform !== "darwin") {
    return [];
  }

  const entries = await fs.readdir(SHIM_DIR);
  const found = await Promise.all(
    entries.map(async (name) =>
      (await isCommandLineToolsStub(path.join(SHIM_DIR, name))) ? name : null,
    ),
  );

  return found.filter((name) => name !== null).sort();
}
