# A fetch that succeeds and returns no content

**Status:** open. The mechanism is measured and understood. The fix belongs in what `web_fetch` reports, and which signal actually changes an agent's behavior is an open question for the eval harness rather than something to guess at. Last checked 2026-09-09.

A user pointed the conversation's agent at a skill kept in a public repository, by pasting the URL of its directory. Three tasks were told to use it. All three reported success. None of them read it, and none of them said they could not.

## What comes back

A hosting service's directory page is an application, not a document. Fetched without a browser it answers **HTTP 200**, `text/html`, and a body whose real content is assembled by scripts that a plain fetch does not run. What survives into the markdown conversion is the furniture: the navigation, the file names, and, in this case, the service's own client-side error text.

> Uh oh! There was an error while loading. Please reload this page.

`web_fetch` sees a 200 and a textual content type, so it takes the success path and returns `state: "success"` with that markdown as the page. Nothing in the result says the page was not read. The status was fine, the content type was fine, the body was non-empty, and the file names in it are real.

That is the worst shape a failure can take. There is no error to report, no retry to attempt, and no gap for the agent to notice. **An agent does not reach for a fallback when it believes it already succeeded**, which is the whole finding.

## The fallbacks were there the whole time

Measured in the agent's own sandbox, both obvious routes work:

```
git clone --depth 1 https://github.com/<org>/<repo>     exit 0, 1.5s, all files present
curl https://raw.githubusercontent.com/<org>/<repo>/... HTTP 200, text/plain, real content
```

Public clone and fetch over http(s) is a documented sandbox capability (see `agent-sandbox.md`). So the agent was not missing a tool and did not need to be taught a URL scheme. It needed to know its first attempt had failed.

## What this is not

**It is not a per-host problem, and per-host instructions are the wrong fix.** Any application-shaped page on any host can answer 200 with furniture and no content; teaching the agent one service's URL forms concedes that every other service needs the same, and the prompt cannot hold the internet. A rule that says "rewrite this host's directory URLs into its raw URLs" is a rule that will be wrong for the next host and will still be sitting in the prompt.

**A yield ratio is not the fix either, though it looks like one.** The idea that a client-rendered page converts to suspiciously little text does not survive measurement:

| page | HTML | markdown out | yield |
|---|---:|---:|---:|
| repo directory page (client-rendered) | 231 KB | 9,898 | 4.2% |
| repo file page (client-rendered) | 270 KB | 15,318 | 5.5% |
| MDN article (server-rendered) | 206 KB | 45,386 | 21.6% |
| Wikipedia article (server-rendered) | 1,833 KB | 1,356,053 | 72.2% |

The failing pages do not produce *too little* text. They produce ten to fifteen thousand characters of navigation. The gap between 4% and 22% is real but the spread among legitimate pages is far wider, and a threshold drawn through seven samples is the same overfitting in numeric clothing.

Worth noting from the same measurement: the `Accept: text/markdown;q=1.0` header already earns `text/markdown` or `text/plain` from docs sites that offer it, at 100% yield. That path is working.

## Why nobody noticed

Two failures compounded, and either alone would have been survivable.

The silent fetch removed the agent's reason to look for another route. And the brief removed its reason to care: the conversation's agent cannot open a link, so what it believes is behind one is a guess, and it had put that guess into the brief alongside the link. The guess was a complete, followable instruction. The task followed it, never opened the link, and produced something that satisfied the brief.

Measured on a real session: a skill whose entire output contract is one self-contained HTML page produced three Markdown reports, because the paraphrase described a table and said nothing about the format. The user found it by noticing the missing HTML, several turns and roughly four million task tokens later.

The brief half is fixed, in the conversation agent's prompt: a link is passed as the user wrote it, nothing written stands in for what is behind it, and a link the task could not read is reported rather than worked around.

## The open question

What should the result say? The tool holds facts it currently discards: the source byte count against the converted character count, and the standing fact that it never runs scripts. Saying either costs tokens on every fetch and neither is certain to change behavior.

That is an empirical question and this repo can answer it. `pnpm eval run --prompt ... --orchestrator` across models, scoring whether the agent notices and reroutes, is worth more than another round of prompt reasoning. Do not ship a heuristic without that measurement.

## Checking it

```
curl -s -o /dev/null -w '%{http_code}\n' <a directory page on a code-hosting service>
```

It prints 200 for a page carrying no content. Any check that reads only the status code cannot tell that apart from a page that was actually read, and neither can the tool as it stands.
