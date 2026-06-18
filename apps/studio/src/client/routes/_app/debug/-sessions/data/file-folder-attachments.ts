import { APP_FOLDER_NAMES } from "@instrument-org/workspace/client";

import { registerSession, SessionBuilder } from "../helpers";

const builder = new SessionBuilder();

// Mock paths only; RelativePath assertions avoid client-side schema validation.
function mockFile({
  filename,
  filePath,
  mimeType,
  size = 1024,
}: {
  filename: string;
  filePath: string;
  mimeType: string;
  size?: number;
}) {
  return {
    filename,
    filePath: filePath as never,
    mimeType,
    modifiedAt: 1_718_198_400_000,
    size,
  };
}

const userMessageGridShowcase = builder.userMessage(
  "Here is a full attachment grid: types, folders, and the expand control.",
  {
    parts: [
      {
        data: {
          files: [
            // user-provided (shown first; image list thumbnail when asset URL resolves)
            mockFile({
              filename: "hero.png",
              filePath: `${APP_FOLDER_NAMES.userProvided}/hero.png`,
              mimeType: "image/png",
              size: 245_760,
            }),
            mockFile({
              filename: "brief.md",
              filePath: `${APP_FOLDER_NAMES.userProvided}/brief.md`,
              mimeType: "text/markdown",
            }),
            mockFile({
              filename: "data.csv",
              filePath: `${APP_FOLDER_NAMES.userProvided}/data.csv`,
              mimeType: "text/csv",
              size: 4096,
            }),
            mockFile({
              filename: "voice.mp3",
              filePath: `${APP_FOLDER_NAMES.userProvided}/voice.mp3`,
              mimeType: "audio/mpeg",
              size: 512_000,
            }),
            // output
            mockFile({
              filename: "summary.pdf",
              filePath: `${APP_FOLDER_NAMES.output}/summary.pdf`,
              mimeType: "application/pdf",
              size: 88_000,
            }),
            mockFile({
              filename: "demo.mp4",
              filePath: `${APP_FOLDER_NAMES.output}/demo.mp4`,
              mimeType: "video/mp4",
              size: 1_024_000,
            }),
            // root-level regular (visible after expanding past the first six)
            mockFile({
              filename: "NOTES.txt",
              filePath: "NOTES.txt",
              mimeType: "text/plain",
            }),
            mockFile({
              filename: "index.html",
              filePath: "index.html",
              mimeType: "text/html",
              size: 2048,
            }),
            // supporting sections (collapsed until "Show more")
            mockFile({
              filename: "deploy.sh",
              filePath: `${APP_FOLDER_NAMES.scripts}/deploy.sh`,
              mimeType: "text/plain",
            }),
            mockFile({
              filename: "SKILL.md",
              filePath: `${APP_FOLDER_NAMES.skills}/pdf/SKILL.md`,
              mimeType: "text/markdown",
            }),
            mockFile({
              filename: "draft.json",
              filePath: `${APP_FOLDER_NAMES.tmp}/draft.json`,
              mimeType: "application/json",
            }),
            mockFile({
              filename: "page.html",
              filePath: `${APP_FOLDER_NAMES.agentRetrieved}/page.html`,
              mimeType: "text/html",
            }),
            mockFile({
              filename: "API.md",
              filePath: "docs/API.md",
              mimeType: "text/markdown",
            }),
            mockFile({
              filename: "auth.ts",
              filePath: "src/lib/auth.ts",
              mimeType: "text/plain",
              size: 2048,
            }),
            mockFile({
              filename: "Button.tsx",
              filePath: "src/components/Button.tsx",
              mimeType: "text/plain",
              size: 1536,
            }),
          ],
        },
        type: "data-attachments" as const,
      },
    ],
  },
);

const assistantMessage1 = builder.assistantMessage(
  "Six files show initially; expand to see root files and each supporting group.",
);

const userMessageWithFolders = builder.userMessage(
  "Folder chips render beside compact file list items.",
  {
    parts: [
      {
        data: {
          files: [
            mockFile({
              filename: "one-off.txt",
              filePath: `${APP_FOLDER_NAMES.userProvided}/one-off.txt`,
              mimeType: "text/plain",
            }),
          ],
          folders: [
            {
              createdAt: 1_718_198_400_000,
              id: "components" as never,
              name: "components",
              path: "/tmp/workspace/components" as never,
            },
            {
              createdAt: 1_718_198_401_000,
              id: "research" as never,
              name: "research",
              path: "/tmp/workspace/research" as never,
            },
          ],
        },
        type: "data-attachments",
      },
    ],
  },
);

const assistantMessage2 = builder.assistantMessage(
  "Folders use list chips; files stay in the compact attachment grid.",
);

registerSession({
  messages: [
    userMessageGridShowcase,
    assistantMessage1,
    userMessageWithFolders,
    assistantMessage2,
  ],
  name: "File and Folder Attachments",
});
