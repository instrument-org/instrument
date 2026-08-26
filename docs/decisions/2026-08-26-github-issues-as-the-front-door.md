# GitHub Issues are the front door for bugs

Date: 2026-08-26

## Context

The repository shipped with issues effectively closed. `.github/ISSUE_TEMPLATE/config.yml` set `blank_issues_enabled: false` and supplied a single contact link pointing at Discussions, so the New Issue chooser offered no way to file anything. The reasoning at the time was that discussions are easier to triage than issues.

That configuration was adopted from [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty), which ran the same pattern: `blank_issues_enabled: false`, one contact link to Discussions, and a decoy template whose body told the reader to close the issue they had just opened.

Two things were true when this was revisited.

The triage advantage never materialized here, because it was never built. Ghostty backs its Issue Triage discussion category with a form of roughly a dozen required fields covering version, operating system, display server, window manager, minimal configuration, and reproduction steps. This repository had four discussion categories and no `DISCUSSION_TEMPLATE` directory at all, so a report arriving through the preferred path landed in an empty text box. Routing to discussions buys structure only if something supplies the structure.

Ghostty has since moved on from the pattern. On 2026-04-07 it introduced a vouch system: a checked-in list of vouched and denounced accounts, maintainer `!vouch` and `!denounce` commands, and workflows that close contributions from unvouched authors. On 2026-08-12 it deleted its issue templates entirely. Issues are now open in its user interface, and a bot closes and locks any opened by an unvouched account. Its stated reason is trust rather than triage load: the project holds that AI has made plausible-looking low-quality contributions cheap enough that it can no longer extend trust by default.

The scale the two projects operate at is not comparable. At the time of this decision Ghostty had roughly 60,000 stars, 2,257 issues, and 5,819 discussions. This repository had 4 stars, zero issues, zero discussions, and 108 pull requests, all of them from the team. The product is in private, invite-only beta.

## Options weighed

**Keep the gate and build the discussion templates.** Preserves the original intent and matches the pattern that was copied. Rejected because discussions do not close from pull requests, do not carry milestones, and are not synced by our issue tracker's GitHub integration, which handles issues and pull requests only. Every report arriving as a discussion has to be transcribed by hand to be tracked.

**Adopt the vouch system.** Rejected. It is defensive machinery sized for a project receiving thousands of contributions from strangers. Applied to a repository with no inbound contributions, it filters nothing and adds a step in front of the small number of high-quality reports the beta is explicitly soliciting.

**Open issues with structured forms.** Chosen.

## Decision

Issues are the front door for anything intended to be tracked: bugs and specific feature requests, each behind a structured form. `blank_issues_enabled` stays `false`, so every issue arrives through a form.

Discussions keep what is genuinely still a conversation: questions, open-ended ideas, and announcements. The Issue Triage category is retired, because its job moved to the bug form.

The bug form requires the two fields that most often decide whether a report is actionable: the platform in full detail, including distribution and desktop environment on Linux, and which model was selected, since automatic model selection means the provider in play is frequently not the one the reporter assumes.

## Consequences

Reports become linkable from commits and pull requests, closable by merge, and syncable to the issue tracker.

Maintainers lose the blank-issue escape hatch along with everyone else. Internal work is tracked elsewhere, so this costs little.

The boundary between a feature request as an issue and an open-ended idea as a discussion is a judgment call, and some reports will land on the wrong side. Both the form intro text and the chooser's contact links state the distinction at the moment a person has to choose. If the split proves confusing in practice, collapsing the ideas category into issues is the cheaper correction than the reverse.

If inbound volume ever grows enough to make an open front door a burden, the gate that was removed here is a configuration file, and the vouch approach is a published action. Neither is expensive to adopt later. Adopting either now would be sizing for a problem this project does not have.

## Implementation

- [Bug report form](../../.github/ISSUE_TEMPLATE/bug.yml)
- [Feature request form](../../.github/ISSUE_TEMPLATE/feature.yml)
- [Issue chooser configuration](../../.github/ISSUE_TEMPLATE/config.yml)
- [Contributing guide](../../CONTRIBUTING.md)
