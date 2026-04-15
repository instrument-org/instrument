import { APP_NAME } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { type AppConfig } from "./app-config/types";
import { redactWorkspacePaths } from "./redact-workspace-paths";

describe("redactWorkspacePaths", () => {
  const APP_DIR_NAME = `${APP_NAME} (Dev)`;
  const appDir = `/Users/test/Library/Application Support/${APP_DIR_NAME}/workspace/projects/test`;
  const appDirEncoded = `/Users/test/Library/Application%20Support/${APP_NAME}%20(Dev)/workspace/projects/test`;
  const mockAppConfig: AppConfig = {
    appDir,
    // other properties would be here in real config
  } as AppConfig;

  it("redacts literal workspace paths", () => {
    const result = redactWorkspacePaths(
      `Error in ${appDir}/file.js`,
      mockAppConfig,
    );
    expect(result).toBe("Error in /file.js");
  });

  it("redacts URL-encoded workspace paths", () => {
    const result = redactWorkspacePaths(
      `file://${appDirEncoded}/node_modules/.pnpm/vite@7.1.3_@types+node@22.17.2_jiti@2.5.1_lightningcss@1.30.1/node_modules/vite/dist/node/module-runner.js`,
      mockAppConfig,
    );
    expect(result).toBe(
      "file:///node_modules/.pnpm/vite@7.1.3_@types+node@22.17.2_jiti@2.5.1_lightningcss@1.30.1/node_modules/vite/dist/node/module-runner.js",
    );
  });

  it("redacts multiple occurrences", () => {
    const result = redactWorkspacePaths(
      `Error at ${appDir}/file1.js and file:${appDirEncoded}/file2.js`,
      mockAppConfig,
    );
    expect(result).toBe("Error at /file1.js and file:/file2.js");
  });

  it("handles mixed encoding within the same message", () => {
    const result = redactWorkspacePaths(
      `Loading ${appDir}/src/index.ts and file:${appDirEncoded}/src/main.ts`,
      mockAppConfig,
    );
    expect(result).toBe("Loading /src/index.ts and file:/src/main.ts");
  });

  it("does not affect unrelated paths", () => {
    const message = "Error in /some/other/path/file.js";
    const result = redactWorkspacePaths(message, mockAppConfig);
    expect(result).toBe("Error in /some/other/path/file.js");
  });
});
