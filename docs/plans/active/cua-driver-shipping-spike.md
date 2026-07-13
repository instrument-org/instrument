---
shaping: true
---

# Cua Driver shipping integration spike

Status: implemented in draft PR #56

## Context

The initial proof of concept invokes an independently installed Cua Driver from
its canonical macOS application path. It proves native app control from an
Instrument task, but it does not cover Windows or Linux and leaves installation,
permissions, daemon startup, and recovery implicit.

## Goal

Identify a distribution and onboarding boundary that can ship incrementally
without weakening platform security or taking ownership of an unproven binary
update channel.

## Questions

| #         | Question                                                                    |
| --------- | --------------------------------------------------------------------------- |
| **X1-Q1** | Which operating systems and architectures have official driver artifacts?   |
| **X1-Q2** | Which platform identities and permissions must own desktop access?          |
| **X1-Q3** | Can Instrument redistribute or bundle the driver?                           |
| **X1-Q4** | How can Instrument find installs without relying on a GUI process's `PATH`? |
| **X1-Q5** | Which upstream contract should determine whether an install is ready?       |
| **X1-Q6** | What is the smallest safe onboarding mechanism Instrument can own now?      |

## Acceptance

This spike is complete when we can describe the supported distribution targets,
permission ownership, discovery paths, readiness contract, and concrete steps
for a cross-platform onboarding slice.

## Findings

- Cua Driver 0.7.1 publishes macOS universal, Windows x64/arm64, and Linux
  x64/arm64 artifacts with a release checksum manifest. The project and Rust
  workspace are MIT licensed.
- The official installer keeps Cua Driver independently installed. Its canonical
  locations are `/Applications/CuaDriver.app` on macOS,
  `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` on Windows, and
  `~/.local/bin/cua-driver` on Linux.
- macOS standalone mode intentionally grants Accessibility and Screen Recording
  to the signed `com.trycua.driver` app. Embedded mode instead requires
  Instrument to spawn a persistent MCP child directly from Electron main,
  request both grants for Instrument, and bridge calls to the workspace.
- Windows uses a Scheduled Task for an interactive-session daemon. Linux needs a
  live desktop, AT-SPI, and platform libraries; native Wayland remains more
  constrained than X11/XWayland.
- `health_report` is the stable, schema-versioned readiness contract.
  Consumers are expected to remain thin and tolerate new check names.
- Full capability probes can block while attempting Accessibility or screen
  capture. The chat readiness command requests the fast core checks plus macOS
  bundle and TCC checks; the first targeted observation remains the end-to-end
  capability proof.
- Older releases without `health_report` fall back to `doctor --json`, keeping
  setup recovery available while the installed sidecar is upgraded.
- Executing a remote installer from an agent command would let an agent install
  persistent desktop-control software and would couple Instrument to mutable
  upstream scripts. Installation and permission grants must remain explicit
  user actions.

## Requirements

| ID  | Requirement                                                                          | Status       |
| --- | ------------------------------------------------------------------------------------ | ------------ |
| R0  | Instrument can drive supported native apps on macOS, Windows, and Linux              | Core goal    |
| R1  | Installation and persistent desktop permissions require an explicit user action      | Must-have    |
| R2  | Driver discovery does not depend on the GUI process inheriting a shell `PATH`        | Must-have    |
| R3  | The platform-specific signing, TCC, and interactive-session identity remains correct | Must-have    |
| R4  | Instrument can explain missing prerequisites and report readiness consistently       | Must-have    |
| R5  | The integration does not silently execute mutable remote installation code           | Must-have    |
| R6  | Driver updates can remain on the upstream-supported path                             | Nice-to-have |

## Shapes

### A: Bundle an embedded driver

| Part | Mechanism                                                                                            | Flag |
| ---- | ---------------------------------------------------------------------------------------------------- | :--: |
| A1   | Vendor checksum-verified driver binaries in Instrument resources                                     |      |
| A2   | Electron main owns a persistent `cua-driver mcp --embedded` child and bridges MCP calls to workspace |  ⚠️  |
| A3   | Instrument requests and explains its own macOS Accessibility and Screen Recording grants             |  ⚠️  |
| A4   | Instrument owns driver versioning, notices, and binary updates                                       |  ⚠️  |

### B: Bundle the standalone driver app

| Part | Mechanism                                                                        | Flag |
| ---- | -------------------------------------------------------------------------------- | :--: |
| B1   | Ship Cua's app and platform binaries as nested resources                         |  ⚠️  |
| B2   | Copy or install the signed sidecar into platform-standard locations on first use |  ⚠️  |
| B3   | Preserve Cua's bundle identity, signing chain, and update lifecycle              |  ⚠️  |

### C: Discover an independently installed sidecar

| Part | Mechanism                                                                                                   | Flag |
| ---- | ----------------------------------------------------------------------------------------------------------- | :--: |
| C1   | Resolve an explicit override, canonical installer paths, then `PATH` on every supported platform            |      |
| C2   | `computer setup` prints platform-specific user-run installation and onboarding steps without executing them |      |
| C3   | `computer doctor` delegates readiness to the stable `health_report` tool                                    |      |
| C4   | Missing-driver and stopped-daemon errors point the agent at the same setup flow                             |      |
| C5   | Continue using Cua's signed app, installers, permission identity, and updater                               |      |

## Fit check

| Req | Requirement                                                                          | Status       |  A  |  B  |  C  |
| --- | ------------------------------------------------------------------------------------ | ------------ | :-: | :-: | :-: |
| R0  | Instrument can drive supported native apps on macOS, Windows, and Linux              | Core goal    | ✅  | ✅  | ✅  |
| R1  | Installation and persistent desktop permissions require an explicit user action      | Must-have    | ✅  | ✅  | ✅  |
| R2  | Driver discovery does not depend on the GUI process inheriting a shell `PATH`        | Must-have    | ✅  | ✅  | ✅  |
| R3  | The platform-specific signing, TCC, and interactive-session identity remains correct | Must-have    | ❌  | ❌  | ✅  |
| R4  | Instrument can explain missing prerequisites and report readiness consistently       | Must-have    | ❌  | ❌  | ✅  |
| R5  | The integration does not silently execute mutable remote installation code           | Must-have    | ✅  | ✅  | ✅  |
| R6  | Driver updates can remain on the upstream-supported path                             | Nice-to-have | ❌  | ❌  | ✅  |

**Notes:**

- A fails R3 and R4 until the Electron-main MCP bridge and Instrument-owned
  permission experience are designed and proven.
- B fails R3 because repackaging a separately signed application makes nested
  signing, installation, and bundle-identity ownership part of Instrument's
  release process. Its readiness flow is also unspecified, so it fails R4.
- A and B fail R6 because Instrument would own a second binary update channel.

## Selected shape

Shape C is the shipping boundary for this slice. It turns the working proof into
a cross-platform, recoverable integration while preserving the upstream security
identity. A later product onboarding screen can place explicit buttons around the
same setup and diagnostic contracts. Embedded mode remains a separate product
decision because it changes which application users grant full desktop access.

## Sources

- [Install Cua Driver](https://cua.ai/docs/how-to-guides/driver/install)
- [Embedding](https://cua.ai/docs/reference/cua-driver/embedding)
- [CLI reference](https://cua.ai/docs/reference/cua-driver/cli-reference)
- [Interface contracts](https://cua.ai/docs/reference/cua-driver/contracts)
- [Platform support](https://cua.ai/docs/reference/cua-driver/platform-support)
- [Cua repository license](https://github.com/trycua/cua/blob/main/LICENSE.md)
- [Cua Driver 0.7.1 release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.7.1)
