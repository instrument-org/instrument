import { afterEach, expect, it } from "vitest";

import { createMemoryAppsConfig } from "../../src/lib/apps/memory-config";
import { checkAppSignIns } from "../../src/lib/apps/sign-in-lost";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../src/lib/workspace-config";
import { seedConnectedApps } from "./connected-app";
import { answerSignIn, cardOnlySignIns } from "./sign-in-ends";

const originalApps = getWorkspaceConfig().apps;
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
});

// The case built on this app scores what the agent does at the refusal, so
// the refusal has to be the one a lapsed sign-in gives, and has to end when
// the card is answered.
it("a signed-out app is refused as a lost sign-in until it has the card's token", async () => {
  const apps = { ...createMemoryAppsConfig(), oauth: cardOnlySignIns() };
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
  const { appsDir } = getWorkspaceConfig();
  ({ close } = await seedConnectedApps(
    [{ kind: "signed-out", name: "Beacon", slug: "beacon" }],
    { apps, appsDir },
  ));

  expect(await checkAppSignIns({ appsDir })).toEqual(["beacon"]);
  expect(await apps.connections.get("beacon")).toMatchObject({
    status: "needs-sign-in",
  });

  await answerSignIn("beacon", "connected", { appsDir });

  expect(await checkAppSignIns({ appsDir })).toEqual([]);
  expect(await apps.connections.get("beacon")).toMatchObject({
    status: "connected",
  });
});
