# A fetch that succeeds and returns no content

**Status:** open. The mechanism is measured and understood. The fix belongs in what `web_fetch` reports, and which signal actually changes an agent's behavior is an open question for the eval harness rather than something to guess at. Last checked 2026-09-09.

A user pointed the conversation's agent at a skill kept in a public repository, by pasting the URL of its directory. Three tasks were told to use it. All three reported success. None of them read it, and none of them said they could not.

## What comes back

A hosting service's directory page is an application, not a document. Fetched without a browser it answers **HTTP 200**, `text/html`, and a body whose real content is assembled by scripts a plain fetch does not run. What survives the markdown conversion is furniture: navigation, sign-in links, breadcrumbs, a footer, and a table of the directory's file names. The page is inconsistent about even that much: one observation returned the service's own client-side error text (`Uh oh! There was an error while loading.`) where another returned the file table.

Either way `web_fetch` sees a 200 and a textual content type, takes the success path, and returns `state: "success"`. Nothing in the result says the content was not read. The status was fine, the type was fine, the body was long, and the file names in it are real.

The failure is not that this looks like nothing. It is that **it looks like progress**. A listing that correctly names `SKILL.md`, `idea.json`, and `starter.html` is genuinely informative, and an agent that receives one has no reason to think it has been stopped.

## What the agent actually did with it

From the task transcript, which is the part worth reading twice.

It reached for the skill deliberately: *"I should load the comparison matrix skill since it's specifically mentioned. I'll begin by fetching the provided URL."* It fetched the directory page. It read the listing correctly and noticed the link to the file it wanted:

> *"I see there's a relative link to GitHub, and I can use the absolute URL for accuracy, even if it's not directly shown."*

Then it never fetched it. The next tool call writes the report, built from the columns the brief had named, in Markdown. The skill's actual contract, one self-contained HTML page, was never read and never met.

So the agent was one hop from the content, said so in its own reasoning, and stopped. Two things plausibly account for that, and they are both upstream of the fetch tool.

**The brief made the second hop optional.** The orchestrator had paraphrased the skill into the brief, naming the exact columns to use. The matrix the task produced matches that list verbatim. With a complete followable spec already in hand, opening `SKILL.md` buys nothing the agent can see. This half is fixed: the conversation agent's prompt now passes a link as the user wrote it and puts nothing of its own in its place.

**The prompt may forbid the hop it needed.** `main.ts` carries `IMPORTANT: You must NEVER invent, guess, or construct a URL`, qualified by *"Use only URLs you actually have: ... present on a page you opened"*. A relative `href` on a page it opened is such a URL, but resolving it against the origin is construction, and the agent's own words flag exactly that tension: *"even if it's not directly shown."* That is inference rather than proof, but the reasoning trace raises the rule's precise condition and then abandons the fetch. A rule written against phishing may be suppressing ordinary link-following.

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

## What it cost

A skill whose entire output contract is one self-contained HTML page produced three Markdown reports across three tasks, because the paraphrase in each brief described a table and said nothing about the format. The user found it by noticing the missing HTML, several turns and roughly four million task tokens later.

## The open question

Where the fix belongs is now narrower than it first looked. The agent was not missing a capability, was not blocked by a tool, and did not fail to notice the page. It declined a second hop it had already identified.

So the candidates worth testing are the two above, not a smarter fetch:

- Whether the URL-construction rule in `main.ts` should say plainly that resolving a relative link found on a page you opened is following a link, not constructing one.
- Whether `web_fetch` should say what it holds and currently discards, chiefly that it never runs scripts, so a page that reads as navigation can be recognized as one.

Both are prompt-shaped, both cost tokens on every call, and neither is demonstrated to change behavior. This repo can settle that: `pnpm eval run --orchestrator` across models, scoring whether the agent takes the second hop. Do not ship either on reasoning alone.

## Checking it

```
curl -s -o /dev/null -w '%{http_code}\n' <a directory page on a code-hosting service>
```

It prints 200 for a page carrying no content. Any check that reads only the status code cannot tell that apart from a page that was actually read, and neither can the tool as it stands.
