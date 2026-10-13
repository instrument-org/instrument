/**
 * The `/usr/bin` tools macOS ships as xcode-select stubs. Each one hands itself
 * to libxcselect's `xcselect_invoke_xcrun`, which resolves the active developer
 * directory before doing anything else; when no developer directory can be
 * found it asks the system to install the Command Line Tools, which puts a
 * dialog on screen.
 *
 * Apple documents most of these under FILES in `man xcode-select`, but the man
 * page list is incomplete (`cc`, `c++`, `objdump`, and others are stubs too),
 * so this is the scan of a real machine (macOS 27): the binaries that import
 * `xcselect_invoke_xcrun`. Other tools link libxcselect only to look the
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
