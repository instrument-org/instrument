import { GIT_AGENT_EMAIL, GIT_AGENT_NAME } from "@instrument-org/shared";
import { resolveGitBinary, setupEnvironment } from "dugite";
import path from "node:path";

// Git config keys and env vars, spelled as git spells them.
// cspell:ignore askpass nosystem

let gitPath: string | undefined;

/**
 * dugite's git; it resolves the asar-unpacked path itself. Resolved lazily and
 * memoized: every shell command imports this module transitively, and dugite
 * throws for an unsupported platform, which at import time would take down far
 * more than git.
 */
export function gitBinaryPath() {
  gitPath ??= resolveGitBinary();
  return gitPath;
}

/**
 * The only transports git may use. When `GIT_ALLOW_PROTOCOL` is set it is the
 * sole check git makes, so no `protocol.*.allow` config can widen it. Omitting
 * `ssh` keeps the user's keys and ssh-agent out of reach; omitting `ext` closes
 * remote-helper command execution (`ext::sh -c ...`); omitting `file` stops the
 * agent cloning repositories from elsewhere on the host.
 */
const ALLOWED_PROTOCOLS = "http:https";

/**
 * Env that isolates git from the user's configuration, credentials, and
 * identity. Merged into every task subprocess's env (`resolveCommandContext`,
 * `execaNodeForTask`), not just the `git` shell command: `<userData>/bin` and
 * `/usr/bin` both carry a `git` that a script can invoke by bare name, so
 * anchoring the isolation to one command shim would leave those uncovered. The
 * argv-level checks in `shell-commands/git.ts` are the layer that cannot work
 * this way, and sit on top of this rather than replacing it.
 *
 * The return type is spelled out because spreading a Record into an object
 * literal drops its index signature, leaving only the `PATH` set below. Both
 * halves matter: the arbitrary GIT_* keys, and PATH as always-present for the
 * callers that read it back.
 */
export function gitSubprocessEnv(
  baseEnv: Record<string, string | undefined> = {},
): Record<string, string | undefined> & { PATH: string } {
  // A minimal base env, so setupEnvironment returns just the vars git needs
  // (GIT_EXEC_PATH, templates, CA bundle) rather than a copy of process.env.
  const pathValue = baseEnv.PATH ?? process.env.PATH;
  const { env } = setupEnvironment(
    {
      GIT_ALLOW_PROTOCOL: ALLOWED_PROTOCOLS,
      // Empty, not unset: git reads GIT_ASKPASS first and only falls through to
      // core.askPass and SSH_ASKPASS when it is absent, so "" both blocks an
      // inherited helper and runs nothing. Without this, GIT_TERMINAL_PROMPT=0
      // would suppress the terminal prompt only for a GUI one to answer it.
      GIT_ASKPASS: "",
      // System gitattributes can name a diff/merge driver to run.
      GIT_ATTR_NOSYSTEM: "1",
      GIT_AUTHOR_EMAIL: GIT_AGENT_EMAIL,
      GIT_AUTHOR_NAME: GIT_AGENT_NAME,
      GIT_COMMITTER_EMAIL: GIT_AGENT_EMAIL,
      GIT_COMMITTER_NAME: GIT_AGENT_NAME,
      // core.longpaths for a bare `git` a script reaches without going through
      // the shell command (which forces the same key on its own argv). Owning
      // all three keys is also what keeps them out of disownedGitVars' reach:
      // COUNT pinned at 1 means a KEY_1 the agent exported names nothing, and
      // its KEY_0/VALUE_0 lose to these. See FORCED_CONFIG for why the key is
      // needed and why config files cannot carry it.
      GIT_CONFIG_COUNT: "1",
      // Skip ~/.gitconfig and the XDG config. Task subprocesses run with the
      // real HOME restored (see uvSubprocessEnv), so git would otherwise pick
      // up the user's identity, credential helpers, and url.insteadOf rewrites.
      GIT_CONFIG_GLOBAL: "",
      GIT_CONFIG_KEY_0: "core.longpaths",
      GIT_CONFIG_VALUE_0: "true",
      // dugite points GIT_CONFIG_SYSTEM at its own bundled gitconfig, but on
      // macOS and Linux that file is an `include` of the host /etc/gitconfig,
      // so ignore system config outright there. On Windows dugite ships minGit,
      // whose system config carries the TLS and CA settings git needs and has
      // no host config to inherit, so leave it in place.
      ...(process.platform === "win32" ? {} : { GIT_CONFIG_NOSYSTEM: "1" }),
      // Outrank core.editor and sequence.editor, which are reachable through a
      // repo's own config and would otherwise run on commit/rebase/tag.
      GIT_EDITOR: "false",
      GIT_SEQUENCE_EDITOR: "false",
      // No credentials are configured, so a private repository must fail fast
      // rather than block on a prompt until the tool times out.
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: "",
    },
    pathValue === undefined ? {} : { PATH: pathValue },
  );

  return {
    // Drop every inherited GIT_* that this function does not own. Overriding an
    // enumerated few is not enough: the agent controls the shell env, and
    // GIT_CONFIG_COUNT/KEY_n/VALUE_n alone sets any config key with no argv
    // involved, while GIT_DIR, GIT_EXTERNAL_DIFF, GIT_INDEX_FILE and friends
    // each reach a capability the argv checks are there to deny.
    ...disownedGitVars(baseEnv, env),
    ...env,
    // Resolve a bare `git` to this one, so a script gets the same binary and
    // version the shell command does instead of whatever the host installed.
    PATH: [path.dirname(gitBinaryPath()), env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

function disownedGitVars(
  baseEnv: Record<string, string | undefined>,
  ownedEnv: Record<string, string | undefined>,
) {
  const inherited = Object.keys({ ...process.env, ...baseEnv });
  const disowned = inherited.filter(
    (key) => key.startsWith("GIT_") && !(key in ownedEnv),
  );
  return Object.fromEntries(disowned.map((key) => [key, undefined]));
}
