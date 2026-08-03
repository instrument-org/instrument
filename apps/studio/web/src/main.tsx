import "./globals.css";
import { installStubs } from "./install-stubs";
import { installKeymap } from "./keymap";

installStubs();
installKeymap();

// Deferred: `@/client/main` reads `window.api` while its module body runs.
// Left unguarded so a failure surfaces as an unhandled rejection rather than a
// blank page.
await import("@/client/main");
