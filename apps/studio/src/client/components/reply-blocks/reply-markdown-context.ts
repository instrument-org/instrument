import { createContext, type ReactNode, useContext } from "react";

/**
 * The reply's own Markdown renderer, for a block whose parts are Markdown
 * too: `block` draws text as the reply would, `inline` draws a cell's words
 * without the paragraph around them. Provided by `Markdown`, which is what
 * keeps the blocks from importing it back.
 */
export const ReplyMarkdownContext = createContext<
  | undefined
  | {
      block: (markdown: string) => ReactNode;
      inline: (markdown: string) => ReactNode;
    }
>(undefined);

const plain = {
  block: (markdown: string): ReactNode => markdown,
  inline: (markdown: string): ReactNode => markdown,
};

export const useReplyMarkdown = () => useContext(ReplyMarkdownContext) ?? plain;
