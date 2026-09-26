// Studio's interface face for the editor's own UI. A shadow root cannot
// declare an @font-face of its own, and the page's stylesheet is the page's,
// so the faces go into the document's font set under a name no page uses;
// the page's DOM is never touched. Inlined as data by the bundle build.
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?inline";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2?inline";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?inline";

const FAMILY = "Instrument UI";

export function loadFonts() {
  for (const [weight, src] of [
    ["400", inter400],
    ["500", inter500],
    ["600", inter600],
  ]) {
    try {
      const face = new FontFace(FAMILY, `url(${src})`, { weight });
      document.fonts.add(face);
      face.load().catch(() => {
        // A page whose policy refuses data fonts keeps the system face.
      });
    } catch {
      // Same: the stack's next face stands in.
    }
  }
}
