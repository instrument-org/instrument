import { syncBootShell } from "@/client/lib/boot-shell";
import { applyInitialTheme } from "@/client/lib/initial-theme";

/**
 * Boot entry for the shell markup in `index.html`: the empty app frame the user
 * sees, and can drag the window by, between the window appearing and the
 * renderer mounting. It ships as its own entry script ahead of `main.tsx` so it
 * runs without waiting on the app's module graph, which in development is most
 * of that gap.
 */

applyInitialTheme();
syncBootShell();
