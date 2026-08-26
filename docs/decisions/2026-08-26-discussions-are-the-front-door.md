# Discussions are the front door, issues are the accepted backlog

Date: 2026-08-26

## Context

The repository routes everyone to Discussions. `.github/ISSUE_TEMPLATE/config.yml` sets `blank_issues_enabled: false` and supplies contact links instead of forms, so the New Issue button offers a set of destinations rather than a text box. The pattern was adopted from [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty).

What was missing was not the gate but the structure behind it. There were four discussion categories and no `.github/DISCUSSION_TEMPLATE/` directory at all, so a report arriving through the preferred path landed in an empty text box. Ghostty's equivalent category is backed by a form demanding version, operating system, display server, window manager, minimal configuration, and reproduction steps. Routing to discussions buys better triage only if something supplies the structure; on its own it just moves the unstructured report to a different tab.

Ghostty still runs this way. It changed the mechanism twice, adding a vouch system on 2026-04-07 and deleting its issue templates on 2026-08-12, but the policy hardened rather than relaxed: a bot now closes and locks any issue opened by a non-maintainer with a message directing them to open a discussion first, and its contributing guide sends every bug to the Issue Triage category with instructions to fill the template in completely. That guide also records the failure mode this design has, which is people filing bugs under Q&A or Feature Requests, where nothing asks for their system details.

Instrument is approaching a public release. Inbound volume is about to stop being zero, which is the condition under which an intake funnel earns its cost.

## Options weighed

**Issues with structured forms as the front door.** Issues link from commits, close on merge, carry milestones, and are what our issue tracker's GitHub integration syncs. The case against is that it puts unfiltered inbound directly into the list that is supposed to mean "decided, scoped, ready to work on," and the sync argument is weaker than it first appears, because promotion preserves it for exactly the reports that end up mattering. Considered and rejected.

**A vouch-style bot gate.** Deferred rather than rejected. It addresses trust, not triage, and it is sized for a project receiving contributions from thousands of strangers. If low-quality inbound becomes the problem after launch, it is a published action and a checked-in list, and adopting it later is cheap.

**Discussions with real templates, issues as the accepted backlog.** Chosen.

## Decision

Discussions are where reports and requests arrive. Issue Triage takes bugs, Feature Requests takes both concrete asks and open-ended ideas, and Q&A takes questions. The first two are backed by templates in `.github/DISCUSSION_TEMPLATE/`, named for their category slugs. Q&A is deliberately left free-form, because it is the lowest-stakes category and a form there is friction without a payoff.

The issue tracker holds work we have accepted. A discussion that reaches a clear, actionable conclusion is promoted to an issue; everything still being worked out stays a discussion, where it can gather replies and upvotes. Every open issue should therefore be ready for someone to pick up.

The bug template requires the two fields that most often decide whether a report is actionable: the platform in full detail, including distribution and desktop environment on Linux, and which model was selected, since automatic selection means the provider in play is frequently not the one the reporter assumes.

Because miscategorization is the known failure mode of this design, each template opens by naming the categories it is not, and the chooser labels every destination by what the reader is trying to do rather than by category name.

The routing is enforced by the repository rather than by convention: `issueCreationPolicy` is set to collaborators only, which GitHub surfaces on the Issues tab. The chooser's contact links are what someone without access sees when they try, so the restriction reads as a redirection rather than as a closed door.

The tracker stays public and browsable. It is the record of what has been accepted and what is being worked on, which is worth more to a reader outside the team than it costs to keep visible.

## Consequences

Reports arrive structured, and the tracker stays a list of accepted work rather than a queue of unverified inbound.

Nothing reaches the issue tracker, and therefore the issue tracker's downstream integrations, until a maintainer promotes it. That is the intended filter, and it means promotion has to actually happen or reports accumulate unactioned in a place nothing else watches.

Blank issues are enabled. While the chooser was the gate, disabling them was what closed it, at the cost of leaving no way to open an issue by hand for anyone at all. With the repository enforcing access directly, that cost buys nothing: the only people who reach the chooser with permission to act on it are maintainers writing up accepted work, and they are exactly who needs a blank issue.

A bug report started from inside the app deep-links to the triage category rather than the chooser, because the category is already known at that point and sending a reporter through a chooser is how bugs end up in Q&A.

## Implementation

- [Bug report template](../../.github/DISCUSSION_TEMPLATE/issue-triage.yml)
- [Feature request template](../../.github/DISCUSSION_TEMPLATE/feature-requests-ideas.yml)
- [Issue chooser configuration](../../.github/ISSUE_TEMPLATE/config.yml)
- [Contributing guide](../../CONTRIBUTING.md)
- [In-app bug report link](../../packages/shared/src/constants.ts)
