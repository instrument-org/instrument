// The editor's UI, drawn into its shadow root over the page. The overlay and
// the dock are placed in viewport coordinates, which are the page's own.
import { icon, mark } from "./icons.js";

export const UI_HTML = `
<div id="ui">
  <div id="edit-frame"></div>
  <div id="overlay">
    <div id="hover" class="box" hidden><span class="tag"></span></div>
    <div id="selbox" class="box sel" hidden></div>
    <div id="pins"></div>
    <div id="flashes"></div>
    <div id="proxies"></div>
  </div>

  <div id="float-layer">
    <div id="tb" class="toolbar" hidden></div>
    <div id="crumbs" hidden></div>
    <div id="tip" role="tooltip" hidden></div>

    <div id="edit-hint" hidden><span class="keys"></span></div>

    <form id="popover" class="pop ask" hidden>
      <div class="pop-head"><span class="kind"></span><span class="where"></span></div>
      <p class="note" hidden></p>
      <textarea rows="3" placeholder="Tell Instrument what to change"></textarea>
      <div class="pop-foot"><span class="hint"><kbd>↵</kbd> send</span><button type="button" class="ghost" data-cancel>Cancel</button><button type="submit" class="primary agent">Send</button></div>
    </form>

    <div id="img-pop" class="pop" hidden>
      <div class="pop-title">Replace image</div>
      <button type="button" class="primary block" data-upload>Upload from this computer…</button>
      <div class="or"><span>or use a link</span></div>
      <form data-url class="inline-form"><input name="url" type="text" spellcheck="false" placeholder="https://…"><button type="submit" class="secondary">Use</button></form>
      <label class="field"><span>Description</span><input name="alt" type="text" placeholder="What the image shows"></label>
    </div>
  </div>

  <aside id="inspector" class="dock-panel" hidden>
    <header class="ins-head"><div><div class="ins-title">Style</div><div class="ins-sub"></div></div><button type="button" class="icon" data-close title="Close">
      ${icon("x", 14)}</button></header>
    <div class="ins-body"></div>
  </aside>

  <aside id="panel" class="dock-panel" hidden>
    <header class="ins-head"><div><div class="ins-title">Asked</div><div class="ins-sub">Sent to Instrument from this page</div></div><button type="button" class="icon" data-close title="Close">
      ${icon("x", 14)}</button></header>
    <ol id="req-list"></ol>
    <p class="empty">Select anything and choose <b>Ask</b> to send it to Instrument. Anything a script makes asks too.</p>
  </aside>

  <div id="agent-pill" hidden>${mark(14)}<span class="text">Instrument changed this page</span></div>
  <div id="toast" hidden><span class="msg"></span><button type="button" class="undo">Undo</button><button type="button" class="redo">Redo</button></div>

  <div id="dock-hint" hidden>Click to select · double-click text to edit</div>
  <div id="dock">
    <button id="done-btn" class="done" title="Back to the page (⌘E)"><span class="dot"></span>Editing<span class="done-label">Done</span></button>
    <span class="dock-sep pill-only"></span>
    <button id="undo-btn" class="icon-btn" title="Undo (⌘Z)" disabled>${icon("undo", 16)}</button>
    <button id="redo-btn" class="icon-btn" title="Redo (⇧⌘Z)" disabled>${icon("redo", 16)}</button>
    <span class="dock-sep"></span>
    <button id="page-btn" class="plain" title="Page colors, corners and type" hidden>${icon("palette", 16)}Page</button>
    <button id="req-btn" class="plain" title="What this page has asked Instrument">Asked <span class="count">0</span></button>
  </div>
  <input type="file" id="img-file" accept="image/*" hidden>
</div>`;
