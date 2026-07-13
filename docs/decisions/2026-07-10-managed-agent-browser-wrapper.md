# Managed agent-browser wrapper

## Context

The upstream `agent-browser` CLI includes connection, profile, restore, plugin,
and lifecycle controls. Those controls can bypass the in-app browser's CDP
bridge and workspace-owned browser policy.

## Decision

Instrument exposes `agent-browser` as a managed wrapper around its built-in
browser target. The wrapper supplies the CDP endpoint and session identity,
owns browser lifecycle and storage policy, and rejects upstream flags and
subcommands that would select another connection or persistence model.

Read-only URL fetches may run without mounting the in-app browser when the
upstream command supports that path.

## Alternatives considered

- Passing arbitrary upstream configuration through lets agents escape the
  workspace-owned browser context.
- Reimplementing browser commands would duplicate the upstream CLI instead of
  retaining its supported interaction surface.

## Implementation

- [Managed command wrapper](../../packages/workspace/src/lib/shell-commands/agent-browser.ts)
- [Browser target manager](../../apps/studio/src/electron-main/browser-view/manager.ts)
- [Commit f4c6dd689](https://github.com/instrument-org/instrument/commit/f4c6dd6897ea1b78fb3075dd969142c73a9834fb)
