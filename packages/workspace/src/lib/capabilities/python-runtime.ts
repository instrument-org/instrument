import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";
import { runtimeLayout } from "../runtime-dir";
import { venvSitePackages } from "../uv";
import { getWorkspaceConfig } from "../workspace-config";
import { SCRIPT_CHANNEL_ENV } from "./channel";
import { replaceFileIn, writeRuntimeFile } from "./runtime-file";

const BOOT_MODULE = "_instrument_boot";

/**
 * Takes the channel out of the environment as the interpreter starts,
 * before any of the script's code runs, and reads its token from the
 * descriptor it arrives on and closes that, so no process the script
 * starts has either; `instrument` reads it from here.
 */
const BOOT_SOURCE = `"""Holds the channel \`instrument\` calls Instrument over, taken at startup."""
import os
import stat


def _take():
    at = os.environ.pop("${SCRIPT_CHANNEL_ENV}", None)
    if at is None:
        return None
    port, _, secret = at.partition(":")
    # "<port>:fd<n>": the token is the first line on descriptor n, read once
    # and closed, so no process the script starts inherits it.
    if not (secret.startswith("fd") and secret[2:].isdigit()):
        return at
    fd = int(secret[2:])
    # Only the socket the spawn handed over: where something closed it on
    # the way, the number may be one the interpreter opened since.
    try:
        if not stat.S_ISSOCK(os.fstat(fd).st_mode):
            return port + ":"
    except OSError:
        return port + ":"
    line = b""
    try:
        os.set_blocking(fd, True)
        while b"\\n" not in line and len(line) < 256:
            chunk = os.read(fd, 256 - len(line))
            if not chunk:
                break
            line += chunk
    except OSError:
        pass
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    return port + ":" + line.decode("utf-8", "replace").strip()


channel = _take()
del _take
`;

/**
 * For the managed Python run bare, whose folders on \`PYTHONPATH\` run no
 * \`.pth\`: \`site\` imports \`sitecustomize\`, which takes its own folder back
 * off \`sys.path\`, takes the channel, then runs the \`sitecustomize\` it
 * stands in front of, where there is one.
 */
const SITE_SOURCE = `import importlib.machinery
import importlib.util
import os
import sys


def _boot():
    def key(entry):
        return os.path.normcase(os.path.realpath(entry))

    here = key(os.path.dirname(__file__))
    sys.path[:] = [entry for entry in sys.path if not entry or key(entry) != here]
    try:
        import ${BOOT_MODULE}  # noqa: F401
    except ImportError:
        pass
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", sys.path)
    if spec is not None and spec.loader is not None:
        module = importlib.util.module_from_spec(spec)
        sys.modules["sitecustomize"] = module
        spec.loader.exec_module(module)


_boot()
del _boot
`;

/** The \`instrument\` module itself. Synchronous; a connection per call, so calls are safe from threads. */
const MODULE_SOURCE = `"""Instrument's capabilities, from a script the agent's shell runs.

    import instrument

    drive = instrument.app("google-drive")
    doc = drive.post("/files", body={"name": "Q4 plan", "mimeType": "application/vnd.google-apps.document"})
    print(doc["id"])
    issues = instrument.app("beacon").list_issues(state="open")
    instrument.apps.request("lantern", "GET", "/issues", params={"state": "open"})

An app's methods: get, post, put, patch, delete (path, params=, body=) make a
request through an API app and return its body, parsed where it is JSON (a
service's error raises); any other name calls that MCP tool with keyword
arguments; call(tool, args) calls one whatever its name; tools() and
tool(name) list them. instrument.apps.request(...) returns the whole
response: {status, url, content_type, body, truncated}.

The model's web and image tools are here too, returning data:
instrument.web.fetch(url) is {url, text, truncated, ...},
instrument.web.search(query) is {kind, sources, text}, and
instrument.images.generate(prompt, file_path=...) saves the image.
instrument.memory.list() and instrument.memory.show(name) read what is
remembered; instrument.window.list() and instrument.window.read(tab) what is
in front of the user.
help(instrument.apps.request) and describe() show what this shell can call.

Calls block and are safe from threads, so a ThreadPoolExecutor fans out. One
the person has to answer raises: NeedsPermission (ask with ask_permission),
CardShown (a card is up; the turn ends), ReadGuideFirst (its message is the
app's guide; read it, then run the script again). Anything else raises Error.
"""

import inspect
import json
import os
import re
import socket
import threading

try:
    import ${BOOT_MODULE}

    _CHANNEL = ${BOOT_MODULE}.channel
except ImportError:
    _CHANNEL = os.environ.pop("${SCRIPT_CHANNEL_ENV}", None)

__all__ = [
    "App",
    "CardShown",
    "Error",
    "NeedsPermission",
    "ReadGuideFirst",
    "app",
    "apps",
    "call",
    "describe",
]


class Error(Exception):
    """A call that failed or was refused; kind says which."""

    def __init__(self, message, kind="failed"):
        super().__init__(message)
        self.kind = kind


class NeedsPermission(Error):
    """The call needs the person's yes: ask for what ask names with ask_permission."""

    def __init__(self, message, ask=None):
        super().__init__(message, "ask")
        self.ask = ask


class CardShown(Error):
    """A card is up for the person; the turn ends once this command returns."""

    def __init__(self, message):
        super().__init__(message, "card")


class ReadGuideFirst(Error):
    """Nothing was sent: the message is the app's guide. Read it, then run the script again."""

    def __init__(self, message):
        super().__init__(message, "read-first")


def _error(reply):
    kind = reply.get("kind", "failed")
    message = reply.get("message", "")
    if kind == "ask":
        return NeedsPermission(message, reply.get("ask"))
    if kind == "card":
        return CardShown(message)
    if kind == "read-first":
        return ReadGuideFirst(message)
    return Error(message, kind)


def _send(request):
    if _CHANNEL is None:
        raise Error("instrument reaches Instrument only from a script the shell's python runs.")
    port, token = _CHANNEL.split(":", 1)
    line = json.dumps(dict(request, id=1))
    with socket.create_connection(("127.0.0.1", int(port))) as connection:
        connection.sendall((token + "\\n" + line + "\\n").encode("utf-8"))
        with connection.makefile("rb") as replies:
            answer = replies.readline()
    if not answer:
        raise Error("The app closed the connection instrument uses.")
    reply = json.loads(answer)
    if "error" in reply:
        raise _error(reply["error"])
    if "capabilities" in reply:
        return reply["capabilities"]
    return reply.get("result")


def call(capability, args=None):
    """Calls one capability by its name, with its fields as a dict."""
    return _send({"args": args or {}, "capability": capability})


_described = None
_describing = threading.Lock()


def describe(name=None):
    """What this shell can call: every capability, or the one named, with its input's JSON Schema."""
    global _described
    with _describing:
        if _described is None:
            _described = _send({"describe": True})
    if name is None:
        return list(_described)
    return next((each for each in _described if each["name"] == name), None)


def _snake(name):
    return re.sub(r"[A-Z]", lambda letter: "_" + letter.group(0).lower(), name)


def _function(shape):
    schema = shape.get("input") or {}
    fields = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    positional = shape.get("positional") or []
    parameters = []
    optional = False
    # Every parameter is spelled in snake_case, as Python's are; the app
    # takes either spelling of a field it declares.
    for field in positional:
        optional = optional or field not in required
        parameters.append(
            inspect.Parameter(
                _snake(field),
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                default=None if optional else inspect.Parameter.empty,
            )
        )
    for field in fields:
        if field not in positional:
            parameters.append(
                inspect.Parameter(
                    _snake(field),
                    inspect.Parameter.KEYWORD_ONLY,
                    default=inspect.Parameter.empty if field in required else None,
                )
            )
    signature = inspect.Signature(parameters)

    def run(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        return call(shape["name"], {key: value for key, value in bound.arguments.items() if value is not None})

    lines = [
        "%s: %s" % (_snake(field), node.get("description"))
        for field, node in fields.items()
        if isinstance(node, dict) and node.get("description")
    ]
    run.__name__ = shape["name"].rsplit(".", 1)[-1]
    run.__qualname__ = shape["name"]
    run.__signature__ = signature
    run.__doc__ = "\\n\\n".join([shape.get("summary", "")] + (["\\n".join(lines)] if lines else []))
    return run


class _Namespace:
    def __init__(self, name):
        self._name = name

    def __getattr__(self, verb):
        if verb.startswith("_"):
            raise AttributeError(verb)
        shape = describe("%s.%s" % (self._name, verb))
        if shape is None:
            raise AttributeError("instrument has no %s.%s" % (self._name, verb))
        function = _function(shape)
        setattr(self, verb, function)
        return function

    def __dir__(self):
        prefix = self._name + "."
        return [
            each["name"][len(prefix):]
            for each in describe()
            if each["name"].startswith(prefix) and "." not in each["name"][len(prefix):]
        ]


apps = _Namespace("apps")


class App:
    """One connected app, by its slug."""

    def __init__(self, slug):
        self.slug = slug

    def __repr__(self):
        return "instrument.app(%r)" % self.slug

    def request(self, method, path, params=None, body=None):
        """One request through an API app, the path relative to its base: the body, parsed where it is JSON."""
        args = {"app": self.slug, "method": method, "path": path}
        if params is not None:
            args["params"] = params
        if body is not None:
            args["body"] = body
        response = call("apps.request", args)
        if response.get("truncated"):
            raise Error("The body was longer than the cap and cut: request less or paginate.")
        return response.get("body")

    def get(self, path, params=None, body=None):
        return self.request("GET", path, params, body)

    def post(self, path, params=None, body=None):
        return self.request("POST", path, params, body)

    def put(self, path, params=None, body=None):
        return self.request("PUT", path, params, body)

    def patch(self, path, params=None, body=None):
        return self.request("PATCH", path, params, body)

    def delete(self, path, params=None, body=None):
        return self.request("DELETE", path, params, body)

    def call(self, tool, args=None, **kwargs):
        """Calls one of the app's tools by its name."""
        return call("apps.call", {"app": self.slug, "args": dict(args or {}, **kwargs), "tool": tool})

    def tools(self):
        """The app's tools, a line each."""
        return call("apps.tools", {"app": self.slug})

    def tool(self, name):
        """One tool in full, with the JSON it takes."""
        return call("apps.tools", {"app": self.slug, "tool": name})

    def __getattr__(self, tool):
        if tool.startswith("_"):
            raise AttributeError(tool)

        def run(**kwargs):
            return self.call(tool, kwargs)

        run.__name__ = tool
        return run


def app(slug):
    """The connected app with this slug."""
    return App(slug)


def __getattr__(name):
    # Every namespace this shell can call, as instrument.web or instrument.images.
    if name.startswith("_"):
        raise AttributeError(name)
    if not any(each["name"].startswith(name + ".") for each in describe()):
        raise AttributeError("instrument has no %s" % name)
    namespace = _Namespace(name)
    globals()[name] = namespace
    return namespace


def __dir__():
    return sorted(set(__all__) | {each["name"].split(".", 1)[0] for each in describe()})
`;

/** The folders the module and the bare interpreter's \`sitecustomize\` are written to. */
function pythonRuntimeDirs() {
  const preload = runtimeLayout(getWorkspaceConfig().runtimeDir).preload;
  return {
    modules: path.join(preload, "python"),
    site: path.join(preload, "python-site"),
  };
}

/**
 * Writes the module, the boot module and the bare interpreter's
 * \`sitecustomize\` into the runtime folder's \`preload/\`, which every
 * native command may read and none may change, wherever what is there
 * differs. Returns the folders: the bare interpreter puts both on
 * \`PYTHONPATH\`, the site folder first.
 */
export async function ensurePythonRuntime(): Promise<{
  modules: string;
  site: string;
}> {
  const dirs = pythonRuntimeDirs();
  await Promise.all([
    writeRuntimeFile(path.join(dirs.modules, "instrument.py"), MODULE_SOURCE),
    writeRuntimeFile(path.join(dirs.modules, `${BOOT_MODULE}.py`), BOOT_SOURCE),
    writeRuntimeFile(path.join(dirs.site, "sitecustomize.py"), SITE_SOURCE),
  ]);
  return dirs;
}

/** The file in a virtualenv that puts the module on `sys.path` and takes the channel at startup. */
const PTH_FILE = "_instrument.pth";

/**
 * Puts the module behind a virtualenv by a `.pth`: its folder, then the
 * import that takes the channel, which `site` runs as it starts, before
 * the script. Rewritten whenever it differs. Never fails the command it
 * runs for: without it, `import instrument` is all a script loses.
 */
export async function linkPythonRuntime(venv: AbsolutePath): Promise<void> {
  const { modules } = await ensurePythonRuntime();
  const pth = path.join(venvSitePackages(venv), PTH_FILE);
  await replaceFileIn(pth, `${modules}\nimport ${BOOT_MODULE}\n`).catch(
    () => undefined,
  );
}
