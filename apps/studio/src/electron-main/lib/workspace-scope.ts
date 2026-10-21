/**
 * What is open for one workspace in this process: each store, watch and
 * timer opened for it, kept under the getter that opened it, with how it
 * closes. A store opens in the scope open when it is first asked for, and
 * closing the scope closes everything opened in it, newest first, so the
 * next use opens the next workspace's.
 *
 * The process has one scope open at a time (`currentWorkspaceScope`). What
 * belongs to a workspace is reached through it rather than kept in a
 * variable of its own, so a process holding two workspaces looks up the one
 * it means.
 */
export class WorkspaceScope {
  readonly #opened = new Map<object, { close?: () => unknown }>();
  readonly #values = new Map<object, unknown>();
  #closed = false;

  /** Whether `close` has run; nothing opens in a closed scope. */
  get closed(): boolean {
    return this.#closed;
  }

  /** The value `key` opened in this scope, opening it on first use. */
  value<Value>(
    key: object,
    open: () => Value,
    close?: (value: Value) => unknown,
  ): Value {
    if (this.#values.has(key)) {
      // Set by the branch below under this same key, with this type.
      return this.#values.get(key) as Value;
    }
    if (this.#closed) {
      throw new Error("This workspace is closed");
    }
    const value = open();
    this.#values.set(key, value);
    this.#opened.set(key, { close: close && (() => close(value)) });
    return value;
  }

  /** The value `key` opened in this scope, if it has. */
  peek<Value>(key: object): undefined | Value {
    // Set by `value` under this same key, with this type.
    return this.#values.get(key) as undefined | Value;
  }

  /** Runs `close` when the scope closes, as though it were a value opened now. */
  onClose(close: () => unknown): void {
    this.#opened.set({}, { close });
  }

  /**
   * Closes everything opened in the scope, newest first. A close that throws
   * goes to `onError` and the rest still close.
   */
  async close(onError: (error: unknown) => void): Promise<void> {
    this.#closed = true;
    const opened = [...this.#opened.values()].toReversed();
    this.#opened.clear();
    this.#values.clear();
    for (const { close } of opened) {
      try {
        await close?.();
      } catch (error) {
        onError(error);
      }
    }
  }
}

let current: WorkspaceScope | undefined;

/** The scope of the workspace open now; made on first use for a process that has opened none yet. */
export function currentWorkspaceScope(): WorkspaceScope {
  current ??= new WorkspaceScope();
  return current;
}

/**
 * Puts a new scope in place of the one open now, which the caller has
 * closed, and answers it.
 */
export function openWorkspaceScope(): WorkspaceScope {
  current = new WorkspaceScope();
  return current;
}

/**
 * A getter that opens its value once per workspace: in the scope open when
 * it is first called, and again in the next scope once that one closed,
 * `close` letting the old one go.
 */
export function perWorkspace<Value>(
  open: () => Value,
  close?: (value: Value) => unknown,
): () => Value {
  const key = {};
  return () => currentWorkspaceScope().value(key, open, close);
}
