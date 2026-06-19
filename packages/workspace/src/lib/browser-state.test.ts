import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ProjectSubdomainSchema } from "../schemas/subdomains";
import { createMockAppConfig } from "../test/helpers/mock-app-config";
import { getBrowserState, recordBrowserUse } from "./browser-state";
import { disposeSessionsStoreStorage } from "./session-store-storage";

const subdomain = ProjectSubdomainSchema.parse("browser-state-test");
const sessionId = StoreId.newSessionId();

let appConfig: ReturnType<typeof createMockAppConfig>;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-state-test-"));
  const projectsDir = path.join(root, "projects");
  appConfig = {
    ...createMockAppConfig(subdomain),
    appDir: AppDirSchema.parse(path.join(projectsDir, subdomain)),
  };
  await fs.mkdir(appConfig.appDir, { recursive: true });
});

afterEach(async () => {
  await disposeSessionsStoreStorage(subdomain);
  await fs.rm(root, { force: true, recursive: true });
});

describe("browser state", () => {
  it("distinguishes unused sessions from recorded browser use", async () => {
    const before = await getBrowserState(appConfig, sessionId);
    expect(before._unsafeUnwrap()).toBeUndefined();

    await recordBrowserUse({ appConfig, sessionId });

    expect(await getBrowserState(appConfig, sessionId)).toMatchObject({
      value: {
        lastUsedAt: expect.any(Date),
      },
    });
  });

  it("preserves the last known page when a later observation has none", async () => {
    await recordBrowserUse({
      appConfig,
      sessionId,
      title: "Example",
      url: "https://example.com",
    });
    await recordBrowserUse({ appConfig, sessionId });

    expect(await getBrowserState(appConfig, sessionId)).toMatchObject({
      value: {
        lastTitle: "Example",
        lastUrl: "https://example.com",
        lastUsedAt: expect.any(Date),
      },
    });
  });
});
