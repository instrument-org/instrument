import { pnpmVersion } from "@/electron-main/lib/pnpm";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  AppSubdomainSchema,
  StoreId,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app } from "electron";
import os from "node:os";
import { z } from "zod";

function buildSystemFrontMatter() {
  const platform = os.platform();
  const osName =
    platform === "darwin"
      ? "macOS"
      : platform === "win32"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : platform;

  const env = app.isPackaged ? "production" : "development";

  return {
    app: `Instrument v${app.getVersion()} (${env})`,
    locale: app.getLocale(),
    node: process.version,
    os: `${osName} ${os.release()} / ${os.arch()}`,
  };
}

const systemInfo = base.handler(async ({ context }) => {
  const pnpmVersionValue = await pnpmVersion();
  return [
    {
      title: "Node Version",
      value: process.version,
    },
    {
      title: "PNPM Version",
      value: pnpmVersionValue,
    },
    {
      title: "Workspace Root",
      value: context.workspaceConfig.rootDir,
    },
  ];
});

const sessionMarkdown = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
      subdomain: AppSubdomainSchema,
    }),
  )
  .output(z.object({ markdown: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const frontMatter = buildSystemFrontMatter();
    return call(
      workspaceRouter.session.toMarkdown,
      { frontMatter, sessionId: input.sessionId, subdomain: input.subdomain },
      { context, signal },
    );
  });

const throwError = base
  .input(
    z.object({
      type: z.enum(["known", "unknown"]),
    }),
  )
  .handler(({ errors, input }) => {
    const error =
      input.type === "known"
        ? errors.NOT_FOUND({ message: "This is a known error for testing" })
        : new Error("This is an uncaught error for testing");
    throw error;
  });

const live = {
  openAnalyticsToolbar: base.handler(async function* ({ signal }) {
    for await (const _payload of publisher.subscribe(
      "debug.open-analytics-toolbar",
      {
        signal,
      },
    )) {
      yield null;
    }
  }),
  openDebugPage: base.handler(async function* ({ signal }) {
    for await (const _payload of publisher.subscribe("debug.open-debug-page", {
      signal,
    })) {
      yield null;
    }
  }),
  openQueryDevtools: base.handler(async function* ({ signal }) {
    for await (const _payload of publisher.subscribe(
      "debug.open-query-devtools",
      {
        signal,
      },
    )) {
      yield null;
    }
  }),
  openRouterDevtools: base.handler(async function* ({ signal }) {
    for await (const _payload of publisher.subscribe(
      "debug.open-router-devtools",
      {
        signal,
      },
    )) {
      yield null;
    }
  }),
  testNotification: base.handler(async function* ({ signal }) {
    for await (const _payload of publisher.subscribe("test-notification", {
      signal,
    })) {
      yield {
        testNotification: true,
      };
    }
  }),
};

export const debug = {
  live,
  sessionMarkdown,
  systemInfo,
  throwError,
};
