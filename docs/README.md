# Instrument documentation

This directory is the **system of record** for how the Instrument monorepo is structured, how to work on it safely, and how agents should operate here.

Start with [ARCHITECTURE.md](ARCHITECTURE.md), then open deeper docs as needed (progressive disclosure).

## Index

| Document | Description |
| -------- | ----------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Problem domain, package map, dependency boundaries |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup, dev servers, common commands |
| [QUALITY.md](QUALITY.md) | Formatting, lint, types, tests, spellcheck |
| [SECURITY.md](SECURITY.md) | Trust boundaries and repo hygiene |
| [design-docs/index.md](design-docs/index.md) | Design doc catalog and principles |
| [product-specs/index.md](product-specs/index.md) | Product specs placeholder index |
| [exec-plans/](exec-plans/) | Active and completed execution plans |
| [references/external.md](references/external.md) | Curated external articles and tools |

## Repository map

```text
apps/studio/           Electron desktop app
packages/workspace/    Agents and workspace logic
packages/shim-client/  Injected client runtime
packages/shared/       Shared types and utilities
packages/ai-gateway/   Local AI gateway
registry/              Read-only skills submodule (do not edit)
```

The root [AGENTS.md](../AGENTS.md) file is intentionally short and points here.
