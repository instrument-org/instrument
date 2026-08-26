# Contributing to Instrument

Instrument is in beta, and feedback from people running it on their own machines is the most useful thing we get. Thank you for taking the time.

## Where things go

Everything starts as a discussion. The issue tracker is not the front door.

| You want to | Go here |
| --- | --- |
| Report something broken | [Issue Triage discussion](https://github.com/instrument-org/instrument/discussions/new?category=issue-triage) |
| Ask for a feature, or float an idea | [Feature Requests, Ideas discussion](https://github.com/instrument-org/instrument/discussions/new?category=feature-requests-ideas) |
| Ask a question, or get help with setup | [Q&A discussion](https://github.com/instrument-org/instrument/discussions/new?category=q-a) |
| Report a security vulnerability | Email `security@tryinstrument.com`. Please do not file in public. See [SECURITY.md](.github/SECURITY.md). |

**Pay attention to the category.** Only Issue Triage asks for the version, platform, and model details a bug report needs. A bug filed under Q&A or Feature Requests means we have to come back and ask for all of it by hand, which is slower for you than filling the form was.

## Issues are the accepted backlog

The [issue tracker](https://github.com/instrument-org/instrument/issues) holds work we have decided to do. It is not where reports arrive.

A discussion that reaches a clear, well-understood, actionable conclusion gets promoted to an issue. Everything still being figured out stays a discussion, where it can gather replies and upvotes without cluttering the list of what is ready to be worked on. The point of the split is that every open issue is genuinely ready for someone to pick up.

Issue creation is restricted to the team, which is why the New Issue button offers you links rather than a form. The tracker itself stays public and readable, so you can always see what has been accepted and what is being worked on.

## Filing a good bug

The Issue Triage template asks for what we need, but two fields decide whether a report can be acted on the same day or sits waiting:

- **Your platform, precisely.** A surprising share of what we fix is specific to one operating system, and on Linux often to one desktop environment. Distribution, version, and desktop environment all matter.
- **Which model was running.** Instrument routes to different providers, and Auto may not pick what you assume. The model picker sits next to the send button, and its current selection is often the explanation for behavior that looks like an app bug.

Search before you open anything. If you find your problem already reported, add a reaction rather than a comment, so everyone subscribed to the thread is not emailed.

Paste error text rather than screenshotting it, so it turns up in search later. Strip API keys before you post.

## Pull requests

Open a discussion before starting on anything substantial, so you do not spend time on a change we are already making or have decided against. A pull request that implements an accepted issue is on the safest ground. Small fixes are welcome without that step.

Development setup is in the [README](README.md); prerequisites are in [.agents/setup.md](.agents/setup.md) and environment variables in [.agents/env.md](.agents/env.md).

Before you push:

```bash
pnpm check-and-test:ci
```

Commit messages in this repository are `scope: description`, where the scope is the package or feature touched (`studio`, `workspace`, `dx`, and so on), lowercase and imperative.

## Understanding your code

Use whatever tools you like, including AI, to write your contribution. What we ask is that you understand the change you are proposing well enough to explain what it does and how it interacts with the rest of the system. We cannot review work that its author cannot discuss.
