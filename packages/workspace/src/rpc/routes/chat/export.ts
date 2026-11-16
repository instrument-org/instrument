import { z } from "zod";

import {
  chatTitleOf,
  renderChatMarkdown,
} from "../../../lib/chat-markdown/chat-markdown";
import { safeName } from "../../../lib/folder-name";
import { writingChatRecords } from "../../../lib/records/chat-records";
import { resolveChat } from "../../../lib/record-folders";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";

/**
 * The chat as Markdown, for the person to save as a file, with the name the
 * file is offered under: the chat's title, spelled as a file may be named.
 */
export const chatMarkdown = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.object({ fileName: z.string(), markdown: z.string() }))
  .handler(async ({ errors, input, context }) => {
    const records = writingChatRecords();
    const markdown =
      records && resolveChat(input.id) !== undefined
        ? await records.read(input.id).then(({ chat }) => ({
            text: renderChatMarkdown({
              chat,
              id: input.id,
              rootDir: context.workspaceConfig.rootDir,
            }),
            title: chatTitleOf(chat),
          }))
        : undefined;
    if (markdown?.text === undefined) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    return {
      fileName: `${safeName(markdown.title)}.md`,
      markdown: markdown.text,
    };
  });
