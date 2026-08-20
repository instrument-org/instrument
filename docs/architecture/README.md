# Architecture

Evergreen maps of the system: how a subsystem or domain is put together and how its pieces layer. This is the living "how it works today" reference, edited in place as the code changes rather than captured as a dated snapshot. One Markdown file per subsystem. Link the code paths a doc describes so it stays tied to the source, and link the `docs/decisions/` record that explains why the design is the way it is.

Nothing here carries a status or a date. If a statement stops being true, correct it where it stands — a dated caveat inside an evergreen doc is the shape this section exists to avoid.

## Index

- [system-overview.md](system-overview.md) — the top-level map: packages and layering, main-vs-renderer topology, on-disk layout, and how an agent turn flows end to end. **Start here.**
- [ai-gateway.md](ai-gateway.md) — model access: the mounted provider-proxy Hono app, plus the model discovery and identity library that workspace and studio consume.
- [agent-sandbox.md](agent-sandbox.md) — how agent tools are contained: path-scoped file I/O, the just-bash virtual filesystem, the agent-browser allowlist, and the real-binary escape hatches. Userland, not OS-level isolation.
- [bash-sandbox-mounts-and-native-binaries.md](bash-sandbox-mounts-and-native-binaries.md) — the `/task` + `/skills` + `/mnt` mount layout, the virtual-to-host path bridge, and the quirks that follow from it.
- [just-bash-upstream.md](just-bash-upstream.md) — which build we consume, every patch and agent-facing workaround we carry because of an upstream gap, and the removal trigger for each. Read before adding a prompt line that steers the agent around sandbox behavior.
- [asset-origin.md](asset-origin.md) — the per-task `assets.<taskId>` HTTP origin: host-header routing, why its path space is the virtual FS path space, cache policy, containment, and what it does not authenticate.
- [in-app-browser.md](in-app-browser.md) — the per-task browser: the renderer-owned `<webview>` pool, paint-host vs visible, the CDP path from `agent-browser` to the guest, and what the panel may do that the agent may not.
- [responsive-layout.md](responsive-layout.md) — why viewport breakpoints are the wrong proxy for layout width under UI zoom and a resizable sidebar, the `@container/app-content` shell container, and the unit rules for portalled content.
- [auto-updater.md](auto-updater.md) — how Studio finds, stages, and installs a build: the pure-reducer / port-seam / wiring split, channel selection, and why the build offered and the build installed can diverge.
- [studio-in-the-browser.md](studio-in-the-browser.md) — `apps/studio/web/`: the real renderer served as a plain web page with the Electron boundary replaced by fixtures. Development only.
