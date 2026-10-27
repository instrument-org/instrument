import { SCRIPT_CHANNEL_ENV } from "./channel";

/**
 * The `instrument` global a `node` script gets, as preload source:
 * `instrument.<namespace>.<verb>(...)` calls the capability by that name
 * over the loopback channel the `node` command opened for this one process,
 * and resolves to its output, or rejects with an `instrument.Error` whose
 * class says what the person or the agent has to do (`NeedsPermission`,
 * `CardShown`, `ReadGuideFirst`). `instrument.apps["<slug>"]` (or
 * `instrument.app("<slug>")`) is an app: `.get(path, { params })` and the
 * other methods make a request through an API app, any other name calls
 * that MCP tool with one object of arguments, `.call(tool, args)` calls one
 * whatever its name, and `.tools()` and `.tool(name)` list them.
 *
 * Positional arguments map onto a capability's fields by the describe
 * answer, asked once at the first call, and a last object carries the rest.
 * The channel's port and token come in the environment, taken out before
 * the script runs, so a process the script starts gets neither.
 *
 * It keeps out of the way of the script's own code: it defines nothing when
 * there is no channel or when `instrument` already exists, the global is
 * non-enumerable (so walking the globals never shows it) and writable and
 * configurable (so a package assigning its own replaces it), and it
 * connects at the first call and holds the process open only while a call
 * is waiting, so a script that never calls exits when its own work is done.
 */
export const INSTRUMENT_NODE_PRELOAD = `
import { connect } from "node:net";

const channelAt = process.env.${SCRIPT_CHANNEL_ENV};
delete process.env.${SCRIPT_CHANNEL_ENV};
if (globalThis.instrument === undefined && channelAt !== undefined) {
  const hidden = (target, key, value) =>
    Object.defineProperty(target, key, { configurable: true, value, writable: true });
  class InstrumentError extends Error {
    constructor(message, kind = "failed") {
      super(message);
      hidden(this, "kind", kind);
    }
  }
  class NeedsPermission extends InstrumentError {
    constructor(message, ask) {
      super(message, "ask");
      hidden(this, "ask", ask);
    }
  }
  class CardShown extends InstrumentError {
    constructor(message) {
      super(message, "card");
    }
  }
  class ReadGuideFirst extends InstrumentError {
    constructor(message) {
      super(message, "read-first");
    }
  }
  // On the prototype, so the stack an uncaught one prints already names it.
  for (const [Class, name] of [
    [InstrumentError, "InstrumentError"],
    [NeedsPermission, "NeedsPermission"],
    [CardShown, "CardShown"],
    [ReadGuideFirst, "ReadGuideFirst"],
  ]) {
    hidden(Class.prototype, "name", name);
  }
  const errorOf = ({ ask, kind, message }) =>
    kind === "ask"
      ? new NeedsPermission(message, ask)
      : kind === "card"
        ? new CardShown(message)
        : kind === "read-first"
          ? new ReadGuideFirst(message)
          : new InstrumentError(message, kind);

  const [port, token] = channelAt.split(":");
  const pending = new Map();
  let nextId = 0;
  let socket;
  let received = "";
  const fail = (error) => {
    socket = undefined;
    received = "";
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };
  const onReply = (reply) => {
    const call = pending.get(reply.id);
    if (call === undefined) return;
    pending.delete(reply.id);
    if (pending.size === 0) socket?.unref();
    if (reply.error !== undefined) call.reject(errorOf(reply.error));
    else call.resolve(reply.capabilities ?? reply.result ?? null);
  };
  const connection = () => {
    if (socket !== undefined) return socket;
    const opened = connect({ host: "127.0.0.1", noDelay: true, port: Number(port) });
    opened.setEncoding("utf8");
    opened.write(token + "\\n");
    opened.on("data", (chunk) => {
      received += chunk;
      for (let end = received.indexOf("\\n"); end !== -1; end = received.indexOf("\\n")) {
        const line = received.slice(0, end);
        received = received.slice(end + 1);
        onReply(JSON.parse(line));
      }
    });
    opened.on("error", fail);
    opened.on("close", () => fail(new InstrumentError("The app closed the connection instrument uses.")));
    socket = opened;
    return opened;
  };
  const send = (request) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { reject, resolve });
      const open = connection();
      open.ref();
      open.write(JSON.stringify({ ...request, id }) + "\\n");
    });
  const call = (capability, args = {}) => send({ args, capability });

  let described;
  const describe = () => {
    described ??= send({ describe: true }).catch((error) => {
      described = undefined;
      throw error;
    });
    return described;
  };
  const snakeCase = (key) => key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
  const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const callNamed = async (name, given) => {
    const shape = (await describe()).find((each) => each.name === name);
    if (shape === undefined) return call(name, given[0]);
    const args = {};
    shape.positional.forEach((field, index) => {
      if (given[index] !== undefined) args[field] = given[index];
    });
    const rest = given.slice(shape.positional.length);
    if (rest.length > 1 || (rest.length === 1 && !isObject(rest[0]))) {
      throw new InstrumentError(
        name + " takes " + (shape.positional.length === 0 ? "" : shape.positional.join(", ") + ", then ") +
          "one object of its other fields.",
      );
    }
    return call(name, { ...rest[0], ...args });
  };

  const METHODS = ["delete", "get", "patch", "post", "put"];
  // An app's own methods hand back the body; a service's error has thrown.
  const request = async (slug, method, path, options) => {
    const response = await call("apps.request", { ...options, app: slug, method, path });
    if (response.truncated) {
      throw new InstrumentError("The body was longer than the cap and cut: request less or paginate.");
    }
    return response.body;
  };
  const app = (slug) =>
    new Proxy({}, {
      get: (_target, key) => {
        if (typeof key !== "string" || key === "then") return undefined;
        if (METHODS.includes(key)) {
          return (path, options = {}) => request(slug, key.toUpperCase(), path, options);
        }
        switch (key) {
          case "request":
            return (method, path, options = {}) => request(slug, method, path, options);
          case "call":
            return (tool, args = {}) => call("apps.call", { app: slug, args, tool });
          case "tools":
            return () => call("apps.tools", { app: slug });
          case "tool":
            return (tool) => call("apps.tools", { app: slug, tool });
          default:
            return (args = {}) => call("apps.call", { app: slug, args, tool: key });
        }
      },
    });
  // \`instrument.<namespace>.<verb>(...)\` calls a capability; under \`apps\`,
  // reading past the name instead makes it an app's slug.
  const verb = (namespace, key) =>
    new Proxy(function instrument() {}, {
      apply: (_target, _this, given) => callNamed(namespace + "." + snakeCase(key), given),
      get: (_target, inner) =>
        namespace === "apps" && typeof inner === "string" && inner !== "then"
          ? app(key)[inner]
          : undefined,
    });
  const namespace = (name) =>
    new Proxy({}, {
      get: (_target, key) => (typeof key === "string" && key !== "then" ? verb(name, key) : undefined),
    });
  const root = {
    app,
    apps: namespace("apps"),
    call,
    CardShown,
    describe: async (name) => {
      const all = await describe();
      return name === undefined ? all : all.find((each) => each.name === name);
    },
    Error: InstrumentError,
    NeedsPermission,
    ReadGuideFirst,
  };
  hidden(globalThis, "instrument", new Proxy(root, {
    get: (target, key) =>
      Object.hasOwn(target, key)
        ? target[key]
        : typeof key === "string" && key !== "then"
          ? namespace(key)
          : undefined,
  }));
}
`;
