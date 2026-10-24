// XML parsing for react-xlsx's parse worker, which Vite prepends to the
// worker's entry (`xlsxWorkerDom` in electron.vite.config.ts).
//
// The worker reads styles, conditional formats, tables, charts and drawings
// with `DOMParser`, and skips all of it when `typeof DOMParser` is
// "undefined", which it always is in a worker. The sheet then opens with its
// values but none of that: no data bars or color scales, no structured
// references, and formulas recomputed with nothing to fall back on.
//
// xmldom stands in for the browser's parser. The worker also reads
// `Node.ELEMENT_NODE` and asks a parsed document for `querySelector
// ("parsererror")`, the browser's sign of malformed XML, so both are supplied:
// a parse that fails returns a document whose root is `<parsererror>`, as a
// browser's does, rather than throwing.
import {
  DOMParser as XmlDomParser,
  Document,
  MIME_TYPE,
  Node,
  onErrorStopParsing,
} from "@xmldom/xmldom";

if (typeof globalThis.DOMParser === "undefined") {
  const parser = new XmlDomParser({ onError: onErrorStopParsing });
  const failed = () =>
    parser.parseFromString("<parsererror/>", MIME_TYPE.XML_APPLICATION);

  Object.assign(Document.prototype, {
    querySelector(this: Document, selector: string) {
      return this.getElementsByTagName(selector).item(0);
    },
  });

  Object.assign(globalThis, {
    DOMParser: class {
      parseFromString(source: string, mimeType: string) {
        try {
          return parser.parseFromString(
            source,
            mimeType === "text/xml"
              ? MIME_TYPE.XML_TEXT
              : MIME_TYPE.XML_APPLICATION,
          );
        } catch {
          return failed();
        }
      }
    },
    Node,
  });
}
