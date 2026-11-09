// Markdown held as a value rather than a file: the Crepe editor over a string
// a form owns, which hears every edit and writes nothing anywhere. The form
// saves it, or doesn't, when the person says so. Blocks nobody touched are
// handed back as they were written (doc-sync.ts), so opening and saving the
// value without an edit changes none of it.
import { splitFrontMatter } from "@instrument-org/shared";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { installBlockHandle } from "./block-handle";
import { calloutsPlugin } from "./callouts";
import { codeBlockInfo, decorateCodeBlocks } from "./code-blocks";
import {
  BLOCK_EDIT_ICONS,
  CODE_MIRROR_SETUP,
  configureMarkdown,
  LINK_TOOLTIP_ICONS,
  nearCaretPlugin,
  TABLE_ICONS,
  TOOLBAR_ICONS,
} from "./crepe-setup";
import { createDocSync, type DiskState, flushDomObserver } from "./doc-sync";
import { fitSelectionToolbar, fitSlashMenu } from "./toolbar-fit";

export type ValueSession = Awaited<ReturnType<typeof createValueSession>>;

export async function createValueSession({
  onChange,
  placeholder,
  root,
  value,
}: {
  /** The whole value after an edit the person made. */
  onChange: (value: string) => void;
  placeholder: string;
  root: HTMLElement;
  value: string;
}) {
  let viewRef: EditorView | null = null;
  const view = () => {
    if (!viewRef) {
      throw new Error("the editor is not up");
    }
    return viewRef;
  };
  let parser: ((md: string) => PMNode) | null = null;
  let serializer: ((doc: PMNode) => string) | null = null;
  const sync = createDocSync({
    parse: (md) => {
      if (!parser) {
        throw new Error("the editor is not up");
      }
      return parser(md);
    },
    serialize: (doc) => {
      if (!serializer) {
        throw new Error("the editor is not up");
      }
      return serializer(doc);
    },
    view,
  });
  // The value as last read or handed out, which untouched blocks are spliced
  // back from; a version is only what doc-sync keys a file's state by.
  let base: DiskState | null = null;
  let replacing = false;
  let onDocChange: (() => void) | null = null;

  const currentText = () =>
    base ? base.fm + sync.splicedBody(view().state.doc, base) : value;

  const changes = $prose(
    () =>
      new Plugin({
        view: () => ({
          update(v, prev) {
            if (v.state.doc === prev.doc) {
              return;
            }
            onDocChange?.();
            if (!replacing && base) {
              onChange(currentText());
            }
          },
        }),
      }),
  );

  const editor = new Crepe({
    defaultValue: splitFrontMatter(value).body,
    featureConfigs: {
      [Crepe.Feature.BlockEdit]: {
        ...BLOCK_EDIT_ICONS,
        // Close to the text, so the handle fits in the document's gutter.
        blockHandle: { getOffset: () => 4 },
      },
      [Crepe.Feature.CodeMirror]: CODE_MIRROR_SETUP,
      [Crepe.Feature.LinkTooltip]: LINK_TOOLTIP_ICONS,
      [Crepe.Feature.Placeholder]: { mode: "doc", text: placeholder },
      [Crepe.Feature.Table]: TABLE_ICONS,
      [Crepe.Feature.Toolbar]: TOOLBAR_ICONS,
    },
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.TopBar]: false,
    },
    root,
  });
  configureMarkdown(editor);
  editor.editor
    .use(codeBlockInfo)
    .use(changes)
    .use(nearCaretPlugin)
    .use(calloutsPlugin);
  await editor.create();
  editor.editor.action((ctx) => {
    viewRef = ctx.get(editorViewCtx);
    parser = ctx.get(parserCtx);
    serializer = ctx.get(serializerCtx);
  });
  const pmView = view();
  const code = decorateCodeBlocks(pmView, root);
  onDocChange = code.schedule;
  code.schedule();
  base = sync.loadDisk(value, "0");
  let revision = 0;

  const stopFittingToolbar = fitSelectionToolbar(root, () => {
    const { from, to } = pmView.state.selection;
    return {
      bottom: pmView.coordsAtPos(to).bottom,
      top: pmView.coordsAtPos(from).top,
    };
  });
  const stopFittingSlashMenu = fitSlashMenu(root, () => {
    const { from } = pmView.state.selection;
    const at = pmView.coordsAtPos(from);
    return { bottom: at.bottom, top: at.top };
  });
  const removeBlockHandle = editor.editor.action((ctx) =>
    installBlockHandle(ctx, root),
  );

  return {
    /** What the editor holds now, as Markdown. */
    currentText: () => {
      flushDomObserver(pmView);
      return currentText();
    },
    destroy: async () => {
      code.destroy();
      stopFittingToolbar();
      stopFittingSlashMenu();
      removeBlockHandle();
      await editor.destroy();
    },
    focus: () => {
      pmView.focus();
    },
    /**
     * Replaces what the editor holds with a value from outside it, such as
     * dictated words landing at its end, with the caret after them. A value
     * the editor already holds is left alone, so the caret stays put.
     */
    setValue: (next: string) => {
      flushDomObserver(pmView);
      if (next === currentText()) {
        return;
      }
      revision += 1;
      const doc = sync.loadDisk(next, String(revision));
      const parsed = parser?.(doc.body);
      if (!parsed) {
        return;
      }
      replacing = true;
      try {
        const tr = pmView.state.tr.replaceWith(
          0,
          pmView.state.doc.content.size,
          parsed.content,
        );
        pmView.dispatch(
          tr.setSelection(TextSelection.atEnd(tr.doc)).scrollIntoView(),
        );
      } finally {
        replacing = false;
      }
      base = doc;
    },
  };
}
