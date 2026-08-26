# Contributing to Instrument

Instrument is in private beta, and feedback from people running it on their own machines is the most useful thing we get. Thank you for taking the time.

## Where things go

| You want to                                      | Go here                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Report something broken                          | [Open a bug report](https://github.com/instrument-org/instrument/issues/new?template=bug.yml)                                       |
| Ask for a specific feature                       | [Open a feature request](https://github.com/instrument-org/instrument/issues/new?template=feature.yml)                              |
| Ask a question, or get help with setup           | [Q&A discussions](https://github.com/instrument-org/instrument/discussions/new?category=q-a)                                        |
| Float an idea that is not a specific request yet | [Feature Requests, Ideas discussions](https://github.com/instrument-org/instrument/discussions/new?category=feature-requests-ideas) |
| Report a security vulnerability                  | Email `security@tryinstrument.com`. Please do not open a public issue. See [SECURITY.md](.github/SECURITY.md).                      |

Issues are for work we intend to track. Discussions are for everything that is still a conversation. If you file in the wrong place we will move it, so pick whichever feels closer and do not worry about it.

## Filing a good bug

The issue forms ask for what we need, but two things make the difference between a report we can act on the same day and one that sits waiting:

- **Your platform, precisely.** A surprising share of what we fix is specific to one operating system, and on Linux often to one desktop environment. Distribution, version, and desktop environment all matter.
- **Which model was running.** Instrument routes to different providers, and Auto may not pick what you assume. The model picker sits next to the send button, and its current selection is often the explanation for behavior that looks like an app bug.

Paste error text rather than screenshotting it, so it turns up in search later. Strip API keys before you post.

## Pull requests

Open an issue or a discussion before starting on anything substantial, so you do not spend time on a change we are already making or have decided against. Small fixes are welcome without that step.

Development setup is in the [README](README.md); prerequisites are in [.agents/setup.md](.agents/setup.md) and environment variables in [.agents/env.md](.agents/env.md).

Before you push:

```bash
pnpm check-and-test:ci
```

Commit messages in this repository are `scope: description`, where the scope is the package or feature touched (`studio`, `workspace`, `dx`, and so on), lowercase and imperative.

## Understanding your code

Use whatever tools you like, including AI, to write your contribution. What we ask is that you understand the change you are proposing well enough to explain what it does and how it interacts with the rest of the system. We cannot review work that its author cannot discuss.
