import os from "node:os";
import path from "node:path";

import { AsyncLocalStorage } from "node:async_hooks";

import { type AppService } from "../permissions/apps";
import { placePaths } from "../permissions/places";
import { reachOf, type Rules } from "../permissions/rules";
import { getWorkspaceConfig } from "../workspace-config";

/** What a native command spawned for a chat is held to. */
export interface NativeReach {
  /** Folders the command may read but not change, such as the skills. */
  readOnly: readonly string[];
  /** Folders the command may change whatever the rules say: its chat's own. */
  readWrite: readonly string[];
  rules: Rules;
  /**
   * The services of the person's apps (`REACHABLE_APPS`) the command may not
   * reach. Every one of them where absent.
   */
  closedServices?: readonly AppService[];
}

const reachStorage = new AsyncLocalStorage<NativeReach>();

/** Runs `run` with every native command it spawns held to `reach`. */
export function withNativeReach<T>(reach: NativeReach, run: () => T): T {
  return reachStorage.run(reach, run);
}

/** The reach the running shell call holds its native commands to, if any. */
export function heldNativeReach(): NativeReach | undefined {
  return reachStorage.getStore();
}

export function currentReach(): NativeReach | undefined {
  return heldNativeReach() ?? appNativeReach();
}

/**
 * The reach of a native command the app starts on its own, outside any
 * chat: it may change nothing on disk except `readWrite`. Undefined when
 * native commands run unsandboxed.
 */
export function appNativeReach(
  readWrite: readonly string[] = [],
): NativeReach | undefined {
  if (!getWorkspaceConfig().nativeSandbox) {
    return undefined;
  }
  const home = os.homedir();
  return {
    readOnly: [],
    readWrite,
    rules: {
      home,
      rules: credentialPlaces(home).map((denied) => ({
        level: "never",
        path: denied,
        place: "passwords",
        source: "place",
      })),
      dangerouslyAllowEveryFolder: false,
    },
  };
}

/**
 * The paths a native command may not read or write when nothing narrower
 * applies: the passwords and sign-ins place, as the built-in rules spell it.
 */
function credentialPlaces(home = os.homedir()): string[] {
  const passwords = placePaths(home).find((place) => place.id === "passwords");
  return [
    ...(passwords?.paths ?? []),
    ...(passwords?.closedUnlessAllowed ?? []),
  ];
}

/**
 * Whether a command held to `reach` may use the person's SSH keys, and so
 * their ssh-agent: the rules allow `~/.ssh`, by a grant in the chat or a
 * rule in Settings.
 */
export function reachesSshKeys(reach: NativeReach): boolean {
  const { home } = reach.rules;
  return (
    reachOf(reach.rules, path.join(home, ".ssh"), "read").level === "allow"
  );
}
