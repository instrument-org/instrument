import ms from "ms";
import { err, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type AppDir } from "../schemas/paths";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { createAppConfig } from "./app-config/create";
import { getSandboxesDir } from "./app-dir-utils";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import {
  disposeSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";

interface RemoveProjectOptions {
  subdomain: ProjectSubdomain;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}

export async function trashProject({
  subdomain,
  workspaceConfig,
  workspaceRef,
}: RemoveProjectOptions) {
  return ResultAsync.fromPromise(
    (async () => {
      // Block until every projectBrowser for this subdomain has fully reaped
      // its WebContentsView and agent-browser daemon sessions, so the
      // Chromium profile is no longer locked when we delete the app dir.
      const browserReaped = new Promise<void>((resolve) => {
        workspaceRef.send({
          type: "prepareToTrashApp",
          value: { onBrowserReaped: resolve, subdomain },
        });
      });

      // Cap the wait so a stuck reap can't hang trashing forever; the old
      // 500ms sleep was already best-effort, this is a strict upper bound.
      await Promise.race([browserReaped, setTimeoutPromise(2000)]);

      // Mark storage as disposing to prevent recreation during deletion
      markStorageAsDisposing(subdomain);

      try {
        const appConfig = createAppConfig({
          subdomain,
          workspaceConfig,
        });

        // Delete node_modules folder before trashing to avoid issues with hard links.
        // On Windows (and potentially other OS) with PNPM hard links, trashing
        // node_modules will fail. Since node_modules can be recreated, we delete
        // it first using the fastest removal method available.
        const nodeModulesPath = absolutePathJoin(
          appConfig.appDir,
          "node_modules",
        );

        if (await pathExists(nodeModulesPath)) {
          await rmrf(nodeModulesPath);
        }

        await removeSandboxNodeModules(appConfig.appDir);

        const disposeResult = await disposeSessionsStoreStorage(subdomain);
        if (disposeResult.isErr()) {
          return err(disposeResult.error);
        }

        await workspaceConfig.trashItem(appConfig.appDir);

        // In the off chance that a future project with the same subdomain is
        // created, we remove the app being trashed.
        workspaceRef.send({
          type: "removeAppBeingTrashed",
          value: { subdomain },
        });

        return ok({ subdomain });
      } finally {
        // Always unmark storage as disposing, even if deletion fails
        unmarkStorageAsDisposing(subdomain);
      }
    })(),
    (error: unknown) =>
      new TypedError.FileSystem(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

async function removeSandboxNodeModules(appDir: AppDir): Promise<void> {
  const sandboxesDir = getSandboxesDir(appDir);

  if (!(await pathExists(sandboxesDir))) {
    return;
  }

  const sandboxEntries = await fs.readdir(sandboxesDir, {
    withFileTypes: true,
  });

  for (const entry of sandboxEntries) {
    if (entry.isDirectory()) {
      const sandboxPath = absolutePathJoin(sandboxesDir, entry.name);
      const nodeModulesPath = absolutePathJoin(sandboxPath, "node_modules");

      if (await pathExists(nodeModulesPath)) {
        await rmrf(nodeModulesPath);
      }
    }
  }
}

async function rmrf(path: string): Promise<void> {
  await fs.rm(path, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: ms("2 seconds"),
  });
}
