/**
 * Guest code just-bash runs inside QuickJS before every `js-exec` script, the
 * `javascript.bootstrap` hook. It reshapes the runtime's own Node shims into
 * what Node code expects, because the agent writes Node code: the runtime
 * calls itself Node-compatible and its help lists `statSync` and
 * `readdirSync` without saying that a stat is a bag of booleans, that a
 * `withFileTypes` or `recursive` option is ignored, or that an error carries
 * no `code`. Each of those is either a `TypeError: not a function` the agent
 * has to work around, or a silently wrong answer.
 *
 * Every shim is defensive (`typeof` checks, in-place edits of the objects the
 * runtime built) so an upstream release that closes a gap makes the matching
 * block a no-op rather than a conflict. See
 * `docs/architecture/just-bash-upstream.md` for what each block waits on.
 *
 * Runs as a script in the shared realm, so everything stays inside the IIFE:
 * a top-level `const fs` here would collide with the same declaration in the
 * agent's script.
 */
export const JS_EXEC_BOOTSTRAP = `(function () {
  "use strict";
  var fs = globalThis.fs;
  var process = globalThis.process;
  var path = require("path");
  var Buffer = globalThis.Buffer;

  // --- process.argv ---
  // The runtime builds [scriptPath, ...args], where scriptPath is "-c" for
  // inline code. Node puts the executable first, and the idiom
  // process.argv.slice(2) counts on that slot being there.
  var argv = process.argv;
  var inline = argv[0] === "-c";
  var scriptFile = inline || argv[0] === "<stdin>" ? undefined : argv[0];
  if (inline) argv[0] = "js-exec";
  else argv.unshift("js-exec");
  process.execPath = "js-exec";
  process.argv0 = "js-exec";

  // --- CommonJS ambience ---
  if (scriptFile !== undefined) {
    globalThis.__filename = scriptFile;
    globalThis.__dirname = path.dirname(scriptFile);
  }
  var mainModule = {
    children: [],
    exports: {},
    filename: scriptFile,
    id: ".",
    loaded: false,
    path: scriptFile === undefined ? process.cwd() : path.dirname(scriptFile),
    paths: [],
  };
  globalThis.module = mainModule;
  globalThis.exports = mainModule.exports;
  // Node leaves require.main undefined for -e code, so the
  // \`require.main === module\` guard runs a file and skips inline code.
  if (scriptFile !== undefined) require.main = mainModule;

  // Node's -e and -p expose the built-in modules as globals; the runtime
  // already does that for fs.
  if (inline) {
    var inlineGlobals = ["path", "os", "util", "events", "url", "assert", "child_process", "buffer", "stream", "string_decoder", "querystring"];
    for (var g = 0; g < inlineGlobals.length; g++) {
      if (!(inlineGlobals[g] in globalThis)) {
        Object.defineProperty(globalThis, inlineGlobals[g], {
          configurable: true, enumerable: false, value: require(inlineGlobals[g]), writable: true,
        });
      }
    }
  }

  // --- fs errors ---
  // The runtime throws a plain Error whose message is libuv-shaped but whose
  // path is relative to the mount it landed on ("open '/x'" for a file at
  // the top of an attached folder), with no code, errno, syscall, or path on
  // the object. Rewrite the same Error in place so its stack still points at
  // the agent's line.
  var ERRNO = {
    EACCES: -13, EBADF: -9, EEXIST: -17, EFBIG: -27, EINVAL: -22, EIO: -5,
    EISDIR: -21, ELOOP: -40, EMFILE: -24, ENAMETOOLONG: -36, ENOENT: -2,
    ENOSPC: -28, ENOTDIR: -20, ENOTEMPTY: -39, EPERM: -1, EROFS: -30, EXDEV: -18,
  };
  var ERRNO_MESSAGE = /^(E[A-Z0-9]+): (.*?)(?:, [a-z]+ '.*')?$/;
  // An uncaught error is reported at its innermost frame, which the shims
  // here, the runtime's own, and the apply() between them would otherwise be.
  var SHIM_FRAME = /\\((?:bootstrap\\.js|<compat>):\\d+|\\(native\\)/;
  function describe(error, syscall, target, dest) {
    if (!(error instanceof Error)) return error;
    if (typeof error.stack === "string") {
      error.stack = error.stack.split("\\n").filter(function (line) { return !SHIM_FRAME.test(line); }).join("\\n");
    }
    if (typeof error.code === "string") return error;
    var match = ERRNO_MESSAGE.exec(error.message);
    if (match === null) return error;
    error.code = match[1];
    if (match[1] in ERRNO) error.errno = ERRNO[match[1]];
    error.syscall = syscall;
    error.path = String(target);
    if (dest !== undefined) error.dest = String(dest);
    error.message = match[1] + ": " + match[2] + ", " + syscall + " '" + target + "'" + (dest === undefined ? "" : " -> '" + dest + "'");
    return error;
  }
  // [sync name, syscall Node names in the message, takes a second path]
  var FS_CALLS = [
    ["readFileSync", "open"], ["writeFileSync", "open"], ["appendFileSync", "open"],
    ["statSync", "stat"], ["lstatSync", "lstat"], ["readdirSync", "scandir"],
    ["mkdirSync", "mkdir"], ["rmSync", "rm"], ["unlinkSync", "unlink"], ["rmdirSync", "rmdir"],
    ["readlinkSync", "readlink"], ["chmodSync", "chmod"], ["realpathSync", "realpath"],
    ["renameSync", "rename", true], ["copyFileSync", "copyfile", true], ["symlinkSync", "symlink", true],
  ];
  function withErrors(original, syscall, twoPaths) {
    return function (target) {
      try {
        return original.apply(fs, arguments);
      } catch (error) {
        throw describe(error, syscall, target, twoPaths ? arguments[1] : undefined);
      }
    };
  }
  for (var c = 0; c < FS_CALLS.length; c++) {
    var call = FS_CALLS[c];
    if (typeof fs[call[0]] === "function") fs[call[0]] = withErrors(fs[call[0]], call[1], call[2] === true);
  }

  // --- fs.Stats ---
  // The runtime's stat is { isFile: boolean, ... , mtime: string }. Node's
  // is an object with methods and Date fields, and stat.isFile() is what a
  // script calls.
  function Stats(raw) {
    var mtime = new Date(raw.mtime);
    this.dev = 0;
    this.mode = raw.mode;
    this.nlink = 1;
    this.uid = 0;
    this.gid = 0;
    this.rdev = 0;
    this.blksize = 4096;
    this.ino = 0;
    this.size = raw.size;
    this.blocks = Math.ceil(raw.size / 512);
    this.atimeMs = this.mtimeMs = this.ctimeMs = this.birthtimeMs = mtime.getTime();
    this.atime = new Date(mtime);
    this.mtime = mtime;
    this.ctime = new Date(mtime);
    this.birthtime = new Date(mtime);
    Object.defineProperty(this, "_kind", { value: { dir: raw.isDirectory === true, file: raw.isFile === true, link: raw.isSymbolicLink === true } });
  }
  Stats.prototype.isFile = function () { return this._kind.file; };
  Stats.prototype.isDirectory = function () { return this._kind.dir; };
  Stats.prototype.isSymbolicLink = function () { return this._kind.link; };
  Stats.prototype.isBlockDevice = Stats.prototype.isCharacterDevice = Stats.prototype.isFIFO = Stats.prototype.isSocket = function () { return false; };
  function toStats(raw) {
    return raw instanceof Stats || typeof raw.isFile === "function" ? raw : new Stats(raw);
  }
  var rawStat = fs.statSync;
  var rawLstat = fs.lstatSync;
  fs.statSync = function (target, options) { return toStats(rawStat(target, options)); };
  fs.lstatSync = function (target, options) { return toStats(rawLstat(target, options)); };
  fs.Stats = Stats;

  // --- fs.Dirent, withFileTypes and recursive ---
  // The runtime's readdir returns names and ignores its options object:
  // on its own, { recursive: true } lists the top level only, silently, and
  // { withFileTypes: true } hands back strings with no isDirectory().
  function Dirent(name, parentPath, kind) {
    this.name = name;
    this.parentPath = parentPath;
    this.path = parentPath;
    Object.defineProperty(this, "_kind", { value: kind });
  }
  Dirent.prototype.isFile = Stats.prototype.isFile;
  Dirent.prototype.isDirectory = Stats.prototype.isDirectory;
  Dirent.prototype.isSymbolicLink = Stats.prototype.isSymbolicLink;
  Dirent.prototype.isBlockDevice = Dirent.prototype.isCharacterDevice = Dirent.prototype.isFIFO = Dirent.prototype.isSocket = Stats.prototype.isSocket;
  function kindOf(target) {
    try {
      var stat = fs.lstatSync(target);
      return { dir: stat.isDirectory(), file: stat.isFile(), link: stat.isSymbolicLink() };
    } catch (_error) {
      return { dir: false, file: false, link: false };
    }
  }
  var rawReaddir = fs.readdirSync;
  fs.readdirSync = function (dir, options) {
    var withFileTypes = options !== null && typeof options === "object" && options.withFileTypes === true;
    var recursive = options !== null && typeof options === "object" && options.recursive === true;
    if (!withFileTypes && !recursive) return rawReaddir(dir);
    var out = [];
    (function walk(parent, prefix) {
      var names = rawReaddir(parent);
      for (var i = 0; i < names.length; i++) {
        var full = path.join(parent, names[i]);
        var kind = kindOf(full);
        out.push(withFileTypes ? new Dirent(names[i], parent, kind) : prefix + names[i]);
        if (recursive && kind.dir) walk(full, prefix + names[i] + "/");
      }
    })(String(dir), "");
    return out;
  };
  fs.Dirent = Dirent;

  // --- fs.promises ---
  // The runtime's promise methods wrap its native functions directly, so
  // they route around every shim above.
  function promised(sync) {
    return function () {
      try {
        return Promise.resolve(sync.apply(fs, arguments));
      } catch (error) {
        return Promise.reject(error);
      }
    };
  }
  var promises = fs.promises;
  if (promises !== null && typeof promises === "object") {
    for (var p = 0; p < FS_CALLS.length; p++) {
      promises[FS_CALLS[p][0].replace(/Sync$/, "")] = promised(fs[FS_CALLS[p][0]]);
    }
    promises.access = function (target) {
      return fs.existsSync(target)
        ? Promise.resolve()
        : Promise.reject(describe(new Error("ENOENT: no such file or directory"), "access", target));
    };
  }

  // fs/promises is a module of its own in Node; the runtime's require knows
  // only the top-level names.
  var rawRequire = globalThis.require;
  if (typeof rawRequire === "function") {
    var subpaths = { "fs/promises": function () { return fs.promises; }, "path/posix": function () { return path.posix || path; } };
    var compatRequire = function (name) {
      var bare = String(name).replace(/^node:/, "");
      if (Object.prototype.hasOwnProperty.call(subpaths, bare)) return subpaths[bare]();
      return rawRequire(name);
    };
    compatRequire.resolve = rawRequire.resolve;
    compatRequire.main = rawRequire.main;
    globalThis.require = compatRequire;
  }

  // --- process streams ---
  // Output leaves the runtime through console.log and console.error, each
  // ending in a newline; a write() that ends in one is exact, and any other
  // gains one.
  function stream(log) {
    return {
      columns: 80,
      end: function (chunk) { if (chunk !== undefined && chunk !== null) this.write(chunk); },
      isTTY: false,
      on: function () { return this; },
      once: function () { return this; },
      write: function (chunk, encoding, callback) {
        var text = typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk.toString() : String(chunk);
        log(text.endsWith("\\n") ? text.slice(0, -1) : text);
        var done = typeof encoding === "function" ? encoding : callback;
        if (typeof done === "function") done();
        return true;
      },
    };
  }
  if (process.stdout === undefined) process.stdout = stream(console.log);
  if (process.stderr === undefined) process.stderr = stream(console.error);
  if (typeof process.nextTick !== "function") {
    process.nextTick = function (callback) {
      var args = Array.prototype.slice.call(arguments, 1);
      Promise.resolve().then(function () { callback.apply(null, args); });
    };
  }

  // --- console ---
  if (typeof console.info !== "function") console.info = console.log;
  if (typeof console.debug !== "function") console.debug = console.log;
  if (typeof console.dir !== "function") console.dir = function (value) { console.log(value); };
  if (typeof console.trace !== "function") console.trace = console.error;

  // --- TextEncoder / TextDecoder ---
  // Over the runtime's Buffer, whose bytes live in _data.
  if (typeof globalThis.TextEncoder !== "function") {
    var TextEncoder = function TextEncoder() { this.encoding = "utf-8"; };
    TextEncoder.prototype.encode = function (input) {
      return Buffer.from(input === undefined ? "" : String(input), "utf8")._data;
    };
    globalThis.TextEncoder = TextEncoder;
  }
  if (typeof globalThis.TextDecoder !== "function") {
    var TextDecoder = function TextDecoder(label) { this.encoding = label === undefined ? "utf-8" : String(label).toLowerCase(); };
    TextDecoder.prototype.decode = function (input) {
      return input === undefined ? "" : Buffer.from(input).toString(this.encoding === "utf-8" ? "utf8" : this.encoding);
    };
    globalThis.TextDecoder = TextDecoder;
  }
})();
`;
