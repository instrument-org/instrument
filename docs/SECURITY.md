# Security

## Submodule and supply chain

- The `registry/` submodule is **read-only** in this repo. Treat it as vendored upstream content, not a place for local fixes.

## Secrets and local configuration

- Do not commit API keys, tokens, passwords, or customer data.
- Follow existing patterns for `.env` and machine-local config. If a script needs secrets, document the required **names** of environment variables in the relevant package or ExecPlan, not the values.

## Process boundaries

- **Main process** code can access Node and OS capabilities; **renderer** and **shim** code should stay within their threat models. When exposing RPC or injected APIs, validate inputs at boundaries and avoid leaking main-process-only capabilities.

## Dependency hygiene

- Root `pnpm-workspace.yaml` documents ignored optional dependencies and catalog pins. Prefer aligned versions across packages and avoid exotic dependency chains blocked by repo policy.
