import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { importTask } from "./import-task";
import { getWorkspaceConfig } from "./workspace-config";

async function createZipData(
  entries: { data: string; filename: string }[],
): Promise<string> {
  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
  for (const entry of entries) {
    await zipWriter.add(entry.filename, new TextReader(entry.data));
  }
  const blob = await zipWriter.close();
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

describe("importTask", () => {
  it("fully normalizes a task extracted from a legacy-layout zip", async () => {
    const workspaceConfig = getWorkspaceConfig();
    const zipFileData = await createZipData([
      { data: `{"name":"Legacy Task"}`, filename: ".instrument/settings.json" },
      { data: "db-bytes", filename: ".instrument/sessions.db" },
      { data: `{"showTutorial":true}`, filename: ".instrument/state.json" },
      { data: `{"name":"task"}`, filename: "package.json" },
      {
        data: "sqlite",
        filename: "work/tmp/agent-browser-profile-abc/Cookies",
      },
    ]);

    const result = await importTask({ workspaceConfig, zipFileData });
    const { taskId } = result._unsafeUnwrap();
    const taskDir = path.join(workspaceConfig.tasksDir, taskId);
    const privateDir = path.join(taskDir, ".instrument");

    // The legacy db name is renamed and the state file is folded into settings.
    expect(fs.readFileSync(path.join(privateDir, "task.db"), "utf8")).toBe(
      "db-bytes",
    );
    expect(fs.existsSync(path.join(privateDir, "sessions.db"))).toBe(false);
    expect(fs.existsSync(path.join(privateDir, "state.json"))).toBe(false);
    const settings = JSON.parse(
      fs.readFileSync(path.join(privateDir, "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings.state).toEqual({ showTutorial: true });

    // Root package entries move into work/.
    expect(
      fs.readFileSync(path.join(taskDir, "work", "package.json"), "utf8"),
    ).toBe(`{"name":"task"}`);
    expect(fs.existsSync(path.join(taskDir, "package.json"))).toBe(false);

    // A browser profile clone restored from the zip is deleted outright.
    expect(
      fs.existsSync(
        path.join(taskDir, "work", "tmp", "agent-browser-profile-abc"),
      ),
    ).toBe(false);
  });
});
