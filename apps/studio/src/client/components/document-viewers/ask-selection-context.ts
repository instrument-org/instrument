import { type ReferenceElement } from "@floating-ui/dom";
import { createContext, useContext } from "react";

/** What a viewer found selected, and where to stand the button. */
export interface AskTarget {
  /** Where in the document the words are, as a reader would say it: "page 3". */
  location?: string;
  /** The words, or a promise of them for a viewer that reads them off a worker. */
  quote: Promise<string> | string;
  reference: ReferenceElement;
}

interface AskSelectionValue {
  /** Shows the button for a selection, or takes it down with null. */
  present: (target: AskTarget | null) => void;
}

export const AskSelectionContext = createContext<AskSelectionValue | null>(
  null,
);

/** A value as a cell of a Markdown table: pipes escaped, line breaks as `<br>`. */
export function markdownCell(value: string) {
  return value
    .replaceAll("|", String.raw`\|`)
    .replaceAll(/\r\n|\r|\n/g, "<br>");
}

/**
 * How a viewer whose selection is not the browser's (a PDF's belongs to
 * pdfium, a spreadsheet's to its canvas) offers it to Instrument. Null where
 * there is nobody to ask: outside a surface that can take a question, such
 * as Quick Look over the file.
 */
export function useAskSelection() {
  return useContext(AskSelectionContext);
}
