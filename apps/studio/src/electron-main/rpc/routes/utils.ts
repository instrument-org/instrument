import type {
  OpenTaskInType,
  SupportedEditor,
  SupportedEditorId,
} from "@/shared/schemas/editors";

import { captureServerEvent } from "@/electron-main/lib/capture-server-event";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import {
  getFileOpenCandidates,
  getFileOpenTarget,
} from "@/electron-main/lib/file-open-target";
import { openExternal } from "@/electron-main/lib/open-external";
import {
  clearServerExceptions,
  getServerExceptions,
} from "@/electron-main/lib/server-exceptions";
import { base } from "@/electron-main/rpc/base";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  closeMainWindow,
  isMainWindowMaximized,
  minimizeMainWindow,
  setTrafficLightForZoom,
  toggleMaximizeMainWindow,
} from "@/electron-main/windows/main/controls";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import {
  OpenTaskInTypeSchema,
  SupportedEditorSchema,
} from "@/shared/schemas/editors";
import {
  ProjectIdSchema,
  readTaskFile,
  RelativeTaskPathSchema,
  resolvePathWithinTaskDir,
  resolveProjectDir,
  taskDir,
  TaskIdSchema,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call, eventIterator } from "@orpc/server";
import { app, clipboard, dialog, nativeImage, shell } from "electron";
import { isBinaryFile } from "isbinaryfile";
import { exec, execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

interface EditorConfig {
  appName: string;
  id: SupportedEditorId;
  name: string;
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const EDITORS_BY_PLATFORM: Record<string, EditorConfig[]> = {
  darwin: [
    { appName: "Cursor", id: "cursor", name: "Cursor" },
    { appName: "Visual Studio Code", id: "vscode", name: "VS Code" },
    { appName: "iTerm", id: "iterm", name: "iTerm" },
    { appName: "Terminal", id: "terminal", name: "Terminal" },
    { appName: "Alacritty", id: "alacritty", name: "Alacritty" },
  ],
  linux: [
    { appName: "Cursor", id: "cursor", name: "Cursor" },
    { appName: "code", id: "vscode", name: "VS Code" },
    { appName: "gnome-terminal", id: "terminal", name: "Terminal" },
    { appName: "konsole", id: "terminal", name: "Konsole" },
    { appName: "xterm", id: "terminal", name: "XTerm" },
    { appName: "alacritty", id: "alacritty", name: "Alacritty" },
  ],
  win32: [
    { appName: "Cursor", id: "cursor", name: "Cursor" },
    { appName: "Visual Studio Code", id: "vscode", name: "VS Code" },
    { appName: "Windows Terminal", id: "terminal", name: "Windows Terminal" },
    { appName: "Command Prompt", id: "cmd", name: "Command Prompt" },
    { appName: "PowerShell", id: "powershell", name: "PowerShell" },
  ],
};

let supportedEditorsCache: null | SupportedEditor[] = null;

const DETECTION_COMMANDS = {
  darwin: (appName: string) => `open -Ra "${appName}"`,
  linux: (appName: string) => `which ${appName}`,
  win32: (appName: string) => `where "${appName}"`,
} as const;

const WINDOWS_COMMAND_MAP: Partial<Record<SupportedEditorId, string>> = {
  cmd: "cmd",
  cursor: "cursor",
  powershell: "powershell",
  terminal: "wt",
  vscode: "code",
};

const getDetectionCommand = (
  editor: EditorConfig,
  platform: string,
): string => {
  if (platform === "win32") {
    const command = WINDOWS_COMMAND_MAP[editor.id];
    if (command) {
      return `where ${command}`;
    }
  }

  const commandFn =
    DETECTION_COMMANDS[platform as keyof typeof DETECTION_COMMANDS];
  return commandFn(editor.appName);
};

const OPEN_COMMANDS = {
  darwin: (appName: string, dir: string) => `open -a "${appName}" "${dir}"`,
  linux: (command: string, dir: string) => `${command} "${dir}"`,
  win32: (command: string, dir: string) => `${command} "${dir}"`,
} as const;

const APP_COMMAND_MAP: Partial<
  Record<SupportedEditorId, Record<string, string>>
> = {
  cursor: { darwin: "Cursor", linux: "cursor", win32: "cursor" },
  terminal: {
    darwin: "Terminal",
    linux: "gnome-terminal --working-directory",
    win32: "wt -d",
  },
  vscode: { darwin: "Visual Studio Code", linux: "code", win32: "code" },
};

const SPECIAL_COMMANDS: Partial<
  Record<SupportedEditorId, (dir: string, platform: string) => string>
> = {
  alacritty: (dir: string, platform: string) => {
    if (platform === "darwin") {
      return `open -na "Alacritty" --args --working-directory "${dir}"`;
    }
    return `alacritty --working-directory "${dir}"`;
  },
  cmd: (dir: string, platform: string) => {
    if (platform !== "win32") {
      throw new Error("Command Prompt is only available on Windows");
    }
    return `cmd /c "cd /d "${dir}" && cmd"`;
  },
  iterm: (dir: string, platform: string) => {
    if (platform !== "darwin") {
      throw new Error("iTerm is only available on macOS");
    }
    return `open -a "iTerm" "${dir}"`;
  },
  powershell: (dir: string, platform: string) => {
    if (platform !== "win32") {
      throw new Error("PowerShell is only available on Windows");
    }
    return `powershell -NoExit -Command "Set-Location '${dir}'"`;
  },
};

const getOpenCommand = (
  type: OpenTaskInType,
  dir: string,
  platform: string,
): string => {
  if (type === "show-in-folder") {
    throw new Error("show-in-folder should be handled separately");
  }

  const specialCommand = SPECIAL_COMMANDS[type];
  if (specialCommand) {
    return specialCommand(dir, platform);
  }

  const appCommands = APP_COMMAND_MAP[type];
  if (!appCommands) {
    throw new Error(`Unknown app type: ${type}`);
  }

  const command = appCommands[platform];
  if (!command) {
    throw new Error(`${type} is not supported on ${platform}`);
  }

  const commandFn = OPEN_COMMANDS[platform as keyof typeof OPEN_COMMANDS];
  return commandFn(command, dir);
};

const checkEditorAvailability = async (
  editor: EditorConfig,
): Promise<SupportedEditor> => {
  const platform = os.platform();

  try {
    const command = getDetectionCommand(editor, platform);
    await execAsync(command);
    return { available: true, id: editor.id, name: editor.name };
  } catch {
    return { available: false, id: editor.id, name: editor.name };
  }
};

const initializeSupportedEditorsCache = async () => {
  if (supportedEditorsCache !== null) {
    return supportedEditorsCache;
  }

  const platform = os.platform();
  const editors = EDITORS_BY_PLATFORM[platform] ?? [];

  const supportedEditors = await Promise.all(
    editors.map(checkEditorAvailability),
  );

  supportedEditorsCache = supportedEditors;
  return supportedEditors;
};

const openExternalLink = base
  .errors({
    INVALID_URL: {
      message: "Invalid URL",
    },
  })
  .output(z.undefined())
  .input(z.object({ url: z.url() }))
  .handler(async ({ errors, input }) => {
    const success = await openExternal(input.url);
    if (!success) {
      throw errors.INVALID_URL();
    }
  });

const openTaskIn = base
  .errors({
    ERROR_OPENING_APP: {
      message: "Error opening app",
    },
  })
  .input(
    z.object({
      id: TaskIdSchema,
      type: OpenTaskInTypeSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    const taskId = input.id;

    const platform = os.platform();

    try {
      if (input.type === "show-in-folder") {
        const errorMessage = await shell.openPath(taskDir(taskId));
        if (errorMessage) {
          captureServerException(errorMessage);
          shell.showItemInFolder(taskDir(taskId));
        }
      } else {
        const command = getOpenCommand(input.type, taskDir(taskId), platform);
        await execAsync(command);
      }

      captureServerEvent("task.opened_in", {
        app_name: input.type,
      });
    } catch (error) {
      throw errors.ERROR_OPENING_APP({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

const openTaskFile = base
  .errors({
    ERROR_OPENING_FILE: {
      message: "Error opening file",
    },
    FILE_NOT_FOUND: {
      message: "File not found",
    },
    INVALID_PATH: {
      message: "Invalid file path",
    },
  })
  .input(
    z.object({
      filePath: RelativeTaskPathSchema,
      id: TaskIdSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    const fullPath = resolvePathWithinTaskDir({
      dir: taskDir(input.id),
      filePath: input.filePath,
    });
    if (!fullPath) {
      throw errors.INVALID_PATH();
    }

    try {
      await fs.access(fullPath);
    } catch {
      throw errors.FILE_NOT_FOUND();
    }

    // openPath resolves with "" on success and an error string on failure
    // (e.g. no app is associated with the type). That's an expected
    // user-environment outcome, not an app bug, so it's surfaced to the client
    // as a typed error and skipped by the RPC exception capture.
    const errorMessage = await shell.openPath(fullPath);
    if (errorMessage) {
      throw errors.ERROR_OPENING_FILE({ message: errorMessage });
    }
  });

const openTaskFileWith = base
  .errors({
    ERROR_OPENING_FILE: {
      message: "Error opening file",
    },
    FILE_NOT_FOUND: {
      message: "File not found",
    },
    INVALID_PATH: {
      message: "Invalid file path",
    },
    UNSUPPORTED_PLATFORM: {
      message: "Choosing an app is only supported on macOS",
    },
  })
  .input(
    z.object({
      appPath: z.string().refine((val) => path.isAbsolute(val)),
      filePath: RelativeTaskPathSchema,
      id: TaskIdSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    if (os.platform() !== "darwin") {
      throw errors.UNSUPPORTED_PLATFORM();
    }

    const fullPath = resolvePathWithinTaskDir({
      dir: taskDir(input.id),
      filePath: input.filePath,
    });
    if (!fullPath) {
      throw errors.INVALID_PATH();
    }

    try {
      await fs.access(fullPath);
    } catch {
      throw errors.FILE_NOT_FOUND();
    }

    try {
      const candidates = await getFileOpenCandidates(fullPath);
      if (!candidates.some(({ appPath }) => appPath === input.appPath)) {
        throw errors.ERROR_OPENING_FILE();
      }
      // execFile (not a shell) so the app path and file path can't be
      // interpreted as shell syntax.
      await execFileAsync("open", ["-a", input.appPath, fullPath]);
    } catch (error) {
      throw errors.ERROR_OPENING_FILE({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

// Default-app name and icon for "Open in {app}" affordances. Fields are null
// when the platform can't resolve them; callers fall back to generic ones.
const getTaskFileOpenTarget = base
  .input(
    z.object({
      filePath: RelativeTaskPathSchema,
      id: TaskIdSchema,
    }),
  )
  .output(
    z.object({
      appName: z.string().nullable(),
      iconDataUrl: z.string().nullable(),
    }),
  )
  .handler(async ({ input }) => {
    const fullPath = resolvePathWithinTaskDir({
      dir: taskDir(input.id),
      filePath: input.filePath,
    });
    if (!fullPath) {
      return { appName: null, iconDataUrl: null };
    }
    return await getFileOpenTarget(fullPath);
  });

// Every app that can open the file (default first), for an "Open with" picker.
// Empty on non-macOS platforms, which lack a portable enumeration.
const getTaskFileOpenCandidates = base
  .input(
    z.object({
      filePath: RelativeTaskPathSchema,
      id: TaskIdSchema,
    }),
  )
  .output(
    z.object({
      apps: z.array(
        z.object({
          appName: z.string(),
          appPath: z.string(),
          iconDataUrl: z.string().nullable(),
        }),
      ),
    }),
  )
  .handler(async ({ input }) => {
    const fullPath = resolvePathWithinTaskDir({
      dir: taskDir(input.id),
      filePath: input.filePath,
    });
    if (!fullPath) {
      return { apps: [] };
    }
    return { apps: await getFileOpenCandidates(fullPath) };
  });

const showFileInFolder = base
  .errors({
    FILE_NOT_FOUND: {
      message: "File not found",
    },
  })
  .input(
    z.object({
      filepath: z.string(),
    }),
  )
  .handler(async ({ errors, input }) => {
    try {
      await fs.access(input.filepath);
      shell.showItemInFolder(input.filepath);
    } catch {
      throw errors.FILE_NOT_FOUND();
    }
  });

const showTaskFileInFolder = base
  .errors({
    FILE_NOT_FOUND: {
      message: "File not found",
    },
    INVALID_PATH: {
      message: "Invalid file path",
    },
  })
  .input(
    z.object({
      filePath: RelativeTaskPathSchema,
      id: TaskIdSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    const taskId = input.id;

    const fullPath = resolvePathWithinTaskDir({
      dir: taskDir(taskId),
      filePath: input.filePath,
    });
    if (!fullPath) {
      throw errors.INVALID_PATH();
    }

    try {
      await fs.access(fullPath);
      shell.showItemInFolder(fullPath);
    } catch {
      throw errors.FILE_NOT_FOUND();
    }
  });

const openFolder = base
  .input(
    z.object({
      folderPath: z
        .string()
        .refine((val) => path.isAbsolute(val), "Path must be absolute"),
    }),
  )
  .handler(async ({ input }) => {
    const errorMessage = await shell.openPath(input.folderPath);
    if (errorMessage) {
      shell.showItemInFolder(input.folderPath);
    }
  });

const exportZip = base
  .input(
    z.object({
      id: TaskIdSchema,
      includeChat: z.boolean().default(false),
    }),
  )
  .output(
    z.object({
      filename: z.string(),
      filepath: z.string(),
    }),
  )
  .handler(async ({ context, input, signal }) => {
    const outputPath = app.getPath("downloads");
    return call(
      workspaceRouter.task.exportZip,
      { ...input, outputPath },
      { context, signal },
    );
  });

const getSupportedEditors = base
  .output(z.array(SupportedEditorSchema))
  .handler(async () => {
    if (supportedEditorsCache !== null) {
      return supportedEditorsCache;
    }

    return await initializeSupportedEditorsCache();
  });

const clearExceptions = base.input(z.void()).handler(() => {
  clearServerExceptions();
});

// The renderer owns the main-window zoom (CSS `zoom`); it reports the current level so
// the main process can keep the macOS traffic lights centered in the toolbar,
// whose visual height scales with that zoom.
const syncZoom = base
  .input(z.object({ zoom: z.number() }))
  .handler(({ input }) => {
    setTrafficLightForZoom(input.zoom);
  });

// Custom title-bar window controls (Windows/Linux, and macOS when force-shown).
const minimizeWindow = base.input(z.void()).handler(() => {
  minimizeMainWindow();
});

const toggleMaximizeWindow = base.input(z.void()).handler(() => {
  toggleMaximizeMainWindow();
});

const closeWindow = base.input(z.void()).handler(() => {
  closeMainWindow();
});

const live = {
  // Current maximized state, so the custom controls can toggle the
  // maximize/restore glyph. Re-yields on OS-driven maximize/unmaximize.
  onWindowFocus: base.handler(async function* ({ signal }) {
    for await (const _ of publisher.subscribe("window.focus-changed", {
      signal,
    })) {
      yield {
        focused: Date.now(),
      };
    }
  }),
  serverExceptions: base
    .output(
      eventIterator(
        z.array(
          z.object({
            code: z.string().optional(),
            id: z.string(),
            message: z.string(),
            rpcPath: z.string().optional(),
            stack: z.string().optional(),
            timestamp: z.number(),
          }),
        ),
      ),
    )
    .handler(async function* ({ signal }) {
      yield getServerExceptions();

      for await (const _ of publisher.subscribe("server-exceptions.updated", {
        signal,
      })) {
        yield getServerExceptions();
      }
    }),
  windowMaximized: base
    .output(eventIterator(z.object({ maximized: z.boolean() })))
    .handler(async function* ({ signal }) {
      yield { maximized: isMainWindowMaximized() };

      for await (const _ of publisher.subscribe("window.maximized-changed", {
        signal,
      })) {
        yield { maximized: isMainWindowMaximized() };
      }
    }),
};

const copyTaskPathToClipboard = base
  .input(
    z.object({
      id: TaskIdSchema,
    }),
  )
  .handler(({ input }) => {
    const taskId = input.id;
    clipboard.writeText(taskDir(taskId));
  });

const copyProjectPathToClipboard = base
  .errors({
    PROJECT_NOT_FOUND: { message: "Project not found" },
  })
  .input(
    z.object({
      id: ProjectIdSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    const dir = await resolveProjectDir(input.id);
    if (!dir) {
      throw errors.PROJECT_NOT_FOUND();
    }
    clipboard.writeText(dir);
  });

const showProjectInFolder = base
  .errors({
    PROJECT_NOT_FOUND: { message: "Project not found" },
  })
  .input(
    z.object({
      id: ProjectIdSchema,
    }),
  )
  .handler(async ({ errors, input }) => {
    const dir = await resolveProjectDir(input.id);
    if (!dir) {
      throw errors.PROJECT_NOT_FOUND();
    }
    const errorMessage = await shell.openPath(dir);
    if (errorMessage) {
      captureServerException(errorMessage);
      shell.showItemInFolder(dir);
    }
  });

const copyFileToClipboard = base
  .errors({
    FILE_NOT_FOUND: { message: "File not found" },
    UNSUPPORTED_TYPE: { message: "Unsupported file type" },
  })
  .input(
    z.object({
      filePath: RelativeTaskPathSchema,
      id: TaskIdSchema,
      isImage: z.boolean(),
    }),
  )
  .handler(async ({ errors, input, signal }) => {
    const buffer = await readTaskFile({
      filePath: input.filePath,
      signal,
      taskId: input.id,
    });

    if (!buffer) {
      throw errors.FILE_NOT_FOUND();
    }

    const isBinary = await isBinaryFile(buffer);

    if (input.isImage && isBinary) {
      const image = nativeImage.createFromBuffer(buffer);
      clipboard.writeImage(image);
    } else if (isBinary) {
      throw errors.UNSUPPORTED_TYPE();
    } else {
      clipboard.writeText(buffer.toString("utf8"));
    }
  });

const showFolderPicker = base
  .output(z.object({ path: z.string() }).nullable())
  .handler(async () => {
    // Pass the parent window so macOS presents a window-modal sheet, which keeps
    // the open-panel service warm across opens. Without a parent it falls back to
    // app-modal and cold-starts the panel every time (~2-3s).
    const parentWindow = getMainWindow();
    const result = await (parentWindow
      ? dialog.showOpenDialog(parentWindow, {
          properties: ["openDirectory", "createDirectory"],
        })
      : dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        }));
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const selectedPath = result.filePaths[0];
    return selectedPath ? { path: selectedPath } : null;
  });

export const utils = {
  clearExceptions,
  closeWindow,
  copyFileToClipboard,
  copyProjectPathToClipboard,
  copyTaskPathToClipboard,
  exportZip,
  getSupportedEditors,
  getTaskFileOpenCandidates,
  getTaskFileOpenTarget,
  live,
  minimizeWindow,
  openExternalLink,
  openFolder,
  openTaskFile,
  openTaskFileWith,
  openTaskIn,
  showFileInFolder,
  showFolderPicker,
  showProjectInFolder,
  showTaskFileInFolder,
  syncZoom,
  toggleMaximizeWindow,
};
