import { type NativeReach, reachesSshKeys } from "./native-sandbox";

/**
 * What a native command inherits from the app's own environment: the
 * variables a program needs to find itself and its platform, and nothing
 * else. The app's environment can carry API keys and tokens (a developer's
 * shell, a provider key set for the app), and a script the agent runs has no
 * business reading them.
 *
 * Kept by reason, from what native commands have needed since they first
 * ran: PATH and the platform's own folders, so a shim (pnpm's call sed and
 * uname) and a CLI that looks up Chrome or the user's profiles find them;
 * locale and time zone, so output reads as the person's; certificates and
 * proxies, so a download works on a network that needs them. Everything a
 * command needs beyond these is set for it by its shim.
 */
const INHERITED = new Set(
  [
    // Where things are.
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    // How text and time read.
    "LANG",
    "LANGUAGE",
    "TZ",
    "TERM",
    "__CF_USER_TEXT_ENCODING",
    // Networks that need a certificate or a proxy.
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    // Windows' own folders and how it runs programs.
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "USERNAME",
    "USERDOMAIN",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "TEMP",
    "TMP",
    "OS",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ].map((name) => name.toUpperCase()),
);

/**
 * The app's environment as a native command may see it. Names compare
 * without case, as Windows does, and every locale variable (`LC_*`) is kept.
 * The ssh-agent's socket is kept for a command whose rules allow `~/.ssh`,
 * so `ssh` signs in with the keys the agent holds once the person allowed
 * that folder. The rules decide it whether or not a sandbox holds the
 * command to them: one nothing holds could read the keys themselves.
 */
export function inheritedEnv(
  env: NodeJS.ProcessEnv = process.env,
  /** The command as `wrapNativeCommand` left it. */
  spawned?: { reach?: NativeReach; unheld?: NativeReach },
): Record<string, string> {
  const reach = spawned?.reach ?? spawned?.unheld;
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    if (
      value !== undefined &&
      (INHERITED.has(upper) || upper.startsWith("LC_"))
    ) {
      kept[name] = value;
    }
  }
  if (env.SSH_AUTH_SOCK && reach && reachesSshKeys(reach)) {
    kept.SSH_AUTH_SOCK = env.SSH_AUTH_SOCK;
  }
  return kept;
}
