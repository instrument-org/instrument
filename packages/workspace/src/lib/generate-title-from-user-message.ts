import {
  type AIGatewayModel,
  fetchAISDKModel,
} from "@instrument-org/ai-gateway";
import { shortenHomePath } from "@instrument-org/shared";
import { generateText } from "ai";
import { ResultAsync } from "neverthrow";
import os from "node:os";
import { dedent } from "radashi";

import { getWorkspaceServerURL } from "../logic/server/url";
import { type SessionMessage } from "../schemas/session/message";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { isNonRetryableGatewayError } from "./gateway-response-body";
import { TASK_NAME_MAX_OUTPUT_TOKENS } from "./llm-token-limits";
import { textForMessage } from "./text-for-message";

// A ceiling, not a target. Short titles are the failure mode this backs off
// from: at five words the only way to fit was to drop the distinguishing
// detail, and a list of "Wikipedia link navigation" and "Documents folder
// contents" tells the reader nothing about which one theirs was. The sidebar is
// 250px, so a title much past this truncates on sight rather than in memory.
export const MAX_TITLE_WORDS = 8;

export function generateTitleFromUserMessage({
  message,
  model,
  workspaceConfig,
}: {
  message: SessionMessage.UserWithParts;
  model: AIGatewayModel.Type;
  workspaceConfig: WorkspaceConfig;
}) {
  return ResultAsync.fromPromise(
    (async () => {
      const userMessage = titleSourceText(message);
      if (!userMessage.trim()) {
        throw new Error("No user message");
      }

      const aiSDKModelResult = await fetchAISDKModel({
        captureException: workspaceConfig.captureException,
        configs: workspaceConfig.getAIProviderConfigs(),
        modelCache: workspaceConfig.modelCache,
        modelURI: model.uri,
        workspaceServerURL: getWorkspaceServerURL(),
      });

      if (!aiSDKModelResult.ok) {
        throw new TypedError.Unknown(
          `Failed to fetch AI SDK model: ${aiSDKModelResult.error.message}`,
        );
      }

      const aiSDKModel = aiSDKModelResult.value;

      const title = await generateText({
        maxOutputTokens: TASK_NAME_MAX_OUTPUT_TOKENS,
        model: aiSDKModel,
        prompt: userMessage,
        system: buildSystemPrompt(),
      });

      if (!title.text.trim()) {
        throw new Error("No title generated");
      }

      let cleanedTitle = title.text.trim();

      cleanedTitle = cleanedTitle.replaceAll(/```[\s\S]*?```/g, "");
      cleanedTitle = cleanedTitle.replaceAll(/```[^\n]*/g, "");
      cleanedTitle = cleanedTitle.replaceAll(/^[#\-=*_]+\s*/gm, "");
      cleanedTitle = cleanedTitle.replaceAll(
        /[\u2500-\u257F\u2580-\u259F]/g,
        "",
      );
      cleanedTitle = cleanedTitle.replaceAll(/^["'`]+|["'`]+$/g, "");
      cleanedTitle = cleanedTitle.replace(
        /^\s*(?:title|name|task|app):\s*/i,
        "",
      );
      cleanedTitle = cleanedTitle.trim();
      cleanedTitle = cleanedTitle.split("\n")[0]?.trim() ?? "";

      const words = cleanedTitle.split(/\s+/).filter(Boolean);
      const limitedTitle = words.slice(0, MAX_TITLE_WORDS).join(" ");

      // Nothing nameable in the message. Failing here leaves the placeholder
      // standing, which is the user's own opening words -- a truer name for
      // "hey" than any sentence invented around it.
      if (!limitedTitle) {
        throw new Error("No title generated");
      }

      return limitedTitle;
    })(),
    (error: unknown) => ({
      message: `Failed to generate title: ${error instanceof Error ? error.message : String(error)}`,
      originalError: error,
    }),
  ).orTee(({ originalError }) => {
    if (!isNonRetryableGatewayError(originalError)) {
      workspaceConfig.captureException(originalError);
    }
  });
}

function buildSystemPrompt(): string {
  // What the examples teach is specificity, not grammar: name the thing, keep
  // whatever tells it apart. A noun phrase suits a subject and an action phrase
  // suits a job, and forcing one on the other is how "Weather inquiry" and
  // "Deleted video" happen. They are drawn from the work this app is asked for
  // -- the user's own files and folders, documents, media, research, the
  // occasional app -- and written the way people type when they have already
  // attached the thing they mean, so the shapes match what actually arrives.
  // The second set names the failure the word cap invites: a title short enough
  // to fit any task in the list.
  const examples = dedent`
    <examples>
    "wat images are in here\n\nFolders attached by user: ~/Downloads" → Images in the Downloads folder
    "what is in here\n\nFolders attached by user: ~/Library/Mobile Documents/com~apple~CloudDocs/Downloads" → Contents of iCloud Drive Downloads
    "go through this and tell me what's safe to delete\n\nFolders attached by user: ~/Documents/Old Projects" → What's safe to delete in Old Projects
    "pull the totals out of these into one sheet\n\nFiles attached by user: march-invoices.pdf, april-invoices.pdf" → Invoice totals from March and April
    "are there duplicates in this?\n\nFiles attached by user: contacts-export.csv" → Duplicates in the contacts export
    "clean this up and cut it to a page\n\nFiles attached by user: cover letter draft.docx" → Cover letter cut to one page
    "stitch these together and drop the audio\n\nFiles attached by user: clip-1.mov, clip-2.mov" → Two clips stitched without audio
    "summarize this for the board meeting thursday\n\nFiles attached by user: q3-report.pdf" → Q3 report for the board meeting
    "what's the best portable monitor for travel right now" → Best portable monitor for travel
    "make me a birthday card for my dad, he sails" → Sailing birthday card for dad
    "build me something to track when I water my plants" → Plant watering tracker app
    "why is my disk still full after emptying the trash" → Why the disk is still full
    "hey" →
    "test" →
    </examples>

    <too_short>
    Each of these drops the detail that would tell it apart from its neighbors in a list. The longer one is the better title.
    "Wikipedia link navigation" → "Navigate five linked Wikipedia pages"
    "Documents folder contents" → "Images and PDFs in Documents"
    "PDF conversion" → "Lease agreement as markdown"
    "Photo edits" → "Scanned receipts cropped and straightened"
    "Video" → "Rotating red square video"
    </too_short>`;

  return dedent`
    <task>
    Name the work the user's message starts, in a short phrase someone would recognize months later in a list.
    </task>

    <important>
    You are ONLY naming the message. Do NOT answer questions, perform tasks, or provide information. The user's message is input to name, not a request for you to respond to.
    Name what the work is about -- its subject, its outcome, the thing being made or asked about. A noun phrase suits a subject and a short action phrase suits a job; pick whichever a reader would recognize faster. Never name the act of messaging.
    Attached files and folders are strong evidence of the subject; use them, spelled as they are given. A message can be nothing but attachments, and the files alone are enough to name it. A folder arrives as its path: name it by its own name, and reach for an ancestor only where that is what tells it apart from an identically named folder somewhere else. Never put a whole path in a title.
    If the message carries nothing to name -- a greeting, a single word, a test -- return nothing at all. An empty answer is correct and expected; the user's own words are kept instead. Never invent a subject, and never fall back to naming the day, the time, or the kind of message it is.
    </important>

    <rules>
    - Specific over short. Prefer concrete nouns and the distinguishing detail -- the file, the folder, the site, the format, the number -- over a vague label that would fit a hundred other messages
    - Maximum ${MAX_TITLE_WORDS} words. It is a ceiling, not a target, but do not drop the distinguishing detail to come in under it
    - Rarely one word, and never a bare category noun ("Video", "Skill", "Data")
    - Every word earns its place: no filler, no throat-clearing
    - Single line only
    - Write it in the language the user wrote in
    - Use sentence case. Never Start Case or Title Case
    - No words like "task", "chat", "conversation", "inquiry", "request", or "help"
    - Return ONLY the title text in plain text format
    - No markdown, quotes, code fences, or formatting
    - No prefixes or labels like "Title:" or "Name:"
    </rules>

    ${examples}
  `.trim();
}

function titleSourceText(message: SessionMessage.UserWithParts): string {
  const text = textForMessage(message);

  const attachments = message.parts.find(
    (part) => part.type === "data-attachments",
  );
  if (!attachments) {
    return text;
  }

  const fileNames = attachments.data.files
    .map((file) => file.filename)
    .join(", ");
  // A project's folders ride along on the first message of every task in that
  // project, so a title drawn from one names the neighbors it has to be told
  // apart from. Only what the user attached to this message is evidence about
  // this task, and only that is what the line below claims to be.
  const folderPaths = (attachments.data.folders ?? [])
    .filter((folder) => folder.source !== "project")
    .map((folder) => shortenHomePath(folder.path, os.homedir()))
    .join(", ");

  const sections = [text];
  if (fileNames) {
    sections.push(`Files attached by user: ${fileNames}`);
  }
  if (folderPaths) {
    sections.push(`Folders attached by user: ${folderPaths}`);
  }

  return sections.join("\n\n");
}
