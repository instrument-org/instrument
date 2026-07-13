# Workspace browser profile

## Context

The built-in browser previously used one Chromium profile per task. That made
cookies, local storage, and browsing history disappear when a user moved to a
different task, even when both tasks belonged to the same workspace.

## Decision

The default browser profile is shared by all tasks in a workspace and stored at
`<workspace>/.instrument/browser-session`.

Task targets, CDP connections, screenshots, downloads, and lifecycle cleanup
remain task and session scoped. Only Chromium profile state is workspace scoped.

## Future isolated tasks

An isolated-task option will select that task's
`<task>/.instrument/browser-session` directory when creating its browser target.
Its cookies, storage, and history will then remain task scoped without changing
the default workspace profile or the browser target lifecycle.

## Alternatives considered

- A global Electron profile shares browsing state across unrelated workspaces.
- A per-task profile as the default requires repeated authentication and hides
  browser history from related tasks.

## Implementation

- [Browser session path](../../packages/workspace/src/lib/task-dir-utils.ts)
- [Browser target creation](../../packages/workspace/src/rpc/routes/browser.ts)
- [Electron session attachment](../../apps/studio/src/electron-main/browser-view/manager.ts)
