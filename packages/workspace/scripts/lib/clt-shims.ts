import fs from "node:fs/promises";
import path from "node:path";

// cspell:ignore dylib libxcselect objdump xcrun

/**
 * The `/usr/bin` tools macOS ships as xcode-select stubs. Each one links
 * `libxcselect.dylib` and resolves the active developer directory before doing
 * anything else; when no developer directory can be found it asks the system to
 * install the Command Line Tools, which puts a modal dialog on screen and
 * blocks the caller until someone answers it.
 *
 * Apple documents most of these under FILES in `man xcode-select`, but the man
 * page list is incomplete (`cc`, `c++`, `objdump`, `heap`, and others are stubs
 * too), so this is the scan of a real machine. `scanCommandLineToolsShims`
 * re-derives it from the running OS; `assertShimListCoversHost` fails loudly
 * when a macOS release adds one we don't know about.
 */
// Apple's tool names, spelled Apple's way. Listing each one as a dictionary
// entry would be longer than the array.
// cspell:disable
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
  "atos",
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
  "devicectl",
  "dsymutil",
  "dwarfdump",
  "dyld_info",
  "filtercalltree",
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
  "heap",
  "ibtool",
  "ictool",
  "indent",
  "install_name_tool",
  "kmutil",
  "ld",
  "leaks",
  "lex",
  "libtool",
  "lipo",
  "lldb",
  "llvm-g++",
  "llvm-gcc",
  "lorder",
  "m4",
  "make",
  "malloc_history",
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
  "sample",
  "sdef",
  "sdp",
  "segedit",
  "size",
  "sourcekit-lsp",
  "stapler",
  "stringdups",
  "strings",
  "strip",
  "swift",
  "swiftc",
  "symbols",
  "unifdef",
  "unifdefall",
  "vmmap",
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
// cspell:enable

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
const SHIM_MARKER = "libxcselect";

/** Mach-O load commands sit at the head of the file, so a prefix read finds the marker. */
const SCAN_BYTES = 65_536;

/** Shim names present on this host that {@link CLT_SHIM_NAMES} does not list. */
export async function findUnlistedHostShims(): Promise<string[]> {
  const known = new Set<string>(CLT_SHIM_NAMES);
  const onHost = await scanCommandLineToolsShims();
  return onHost.filter((name) => !known.has(name));
}

/**
 * Names in {@link SHIM_DIR} whose binary references `libxcselect`, read off the
 * running OS. Used to keep {@link CLT_SHIM_NAMES} honest across macOS releases.
 */
async function scanCommandLineToolsShims(): Promise<string[]> {
  if (process.platform !== "darwin") {
    return [];
  }

  const entries = await fs.readdir(SHIM_DIR);
  const found = await Promise.all(
    entries.map(async (name) => {
      const handle = await fs.open(path.join(SHIM_DIR, name)).catch(() => null);
      if (handle === null) {
        return null;
      }
      try {
        const buffer = Buffer.alloc(SCAN_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, SCAN_BYTES, 0);
        return buffer.subarray(0, bytesRead).includes(SHIM_MARKER)
          ? name
          : null;
      } catch {
        return null;
      } finally {
        await handle.close();
      }
    }),
  );

  return found.filter((name) => name !== null).sort();
}
