# Plan: the app directory, made connectable and drawn well

Status: proposed. Nothing below is built yet except the icon precedence it builds on (an app's own `icon.svg`/`icon.png`, then its Mac app's icon, then the site favicon).

The directory (`packages/workspace/src/lib/apps/catalog-seed.json`, read through `catalog.ts` and `app catalog`) is a curated snapshot of a public integrations index: 127 entries, each with a domain, interfaces, and auth kinds. It is what the chat matches a request against and what the Apps page lists. An audit of every entry (endpoints probed for OAuth metadata, vendor docs read) found it mostly connectable, unevenly described, and missing whole families people ask for by name.

## What the audit found

- **Connectable today:** 110 entries work with no registered client: about 83 hosted MCP servers with dynamic client registration, about 20 open ones, the rest a key the user creates.
- **Blocked on a vendor:** 10 need a registered OAuth client or app review: Google (verification, weeks to months for Gmail and full Drive scopes), Slack (Marketplace review), Zoom (Marketplace), Asana and HubSpot (self-serve, minutes), Box (admin-created credentials), Xero (5 organizations free), QuickBooks, Instacart, Spotify (effectively closed).
- **Set-up lines that fail on working services (7):** a hosted MCP set-up line never carries `--auth`, so render, firecrawl, oxylabs and browserbase get an OAuth card for a key; pagerduty needs a `Token token=` header; globalping and semgrep are marked open but want OAuth.
- **Stale or wrong entries:** GitHub's MCP server is reachable with a token; HubSpot's endpoint moved to `mcp.hubspot.com`; Shopify's set-up picks a store-seeding server; `canvas` describes Canva but points at canvas.com (Instructure); Cloudflare lists three servers and set-up only reaches the first.
- **Missing families:** no Microsoft 365, no Apple apps, and no local-server entries at all, although `--local` and `--mac-app` exist. "microsoft" matches the Microsoft Learn docs server.
- **Matching:** slug, name, domain, tagline and categories only, every word required, no aliases. "gmail" reaches Google Workspace only through its tagline; "outlook", "teams", "trello", "apple notes" find nothing.
- **Data:** 24 entries have no `home`, which is where a web-app fallback would land. Taglines and descriptions are in three voices (noun lists, vendor marketing, agent instructions). 46 categories, 11 used once.
- **Icons:** 32 entries draw under 128px from the favicon proxy (Google Workspace at 20px, the site itself declares only that).

## Shape

**Per product, grouped by family.** Users ask for Gmail and Outlook, not Workspace and 365. Split Google into Gmail, Calendar and Drive (Docs, Sheets and Slides as Drive aliases at first), Microsoft into Outlook, OneDrive/SharePoint and Teams, and Apple into one entry per Mac app (Notes, Reminders, Calendar, Mail, Messages). A `family` field lets one sign-in cover the products it covers and asks for each product's scopes as it is added. Atlassian stays one connection with `aliases` for Jira, Confluence and Compass. Verification is per scope, so a family can ship product by product.

**An ordered way in, ending at the browser.** Each entry carries `connect`, tried top to bottom by the card and the agent:

```json
"connect": [
  { "kind": "mcp-oauth", "endpoint": "https://mcp.linear.app/mcp", "registration": "dcr" },
  { "kind": "api-key", "endpoint": "https://api.linear.app/graphql", "placement": "bearer", "keyUrl": "https://linear.app/settings/account/security" },
  { "kind": "browser", "signIn": "https://linear.app/login", "work": "https://linear.app" }
]
```

Kinds: `mcp-oauth` (registration `dcr`, `cimd`, or `preregistered`), `mcp-key`, `mcp-open`, `api-key`, `local`, `mac-app`, `browser`. Every entry ends in `browser`: the user signs in to the web app in the window's browser and the agent works it from then on. That is the answer for the long tail and for vendors that refuse or delay agentic clients, stated per entry rather than left as a generic last resort. `keyUrl` makes pasting a key one click.

**Tiers.** Featured (about 20, tested end to end, in onboarding), supported (probed and working, with `verifiedAt`), listed (browser first), and hidden from general listings (developer-docs servers and duplicates of built-in search), still matchable by exact name.

**Other fields.** `aliases` (matched at the top rank), `icon` (per product, never per family), `blockedBy` on vendor-gated entries (`vendor-review`, `admin-consent`, `partner-only`, `allowlist`, with a link and rough wait), a fixed list of about 15 categories, and a tagline rule: a noun phrase, no "agent", no marketing.

**A probe.** A script that walks every entry's endpoints, checks OAuth metadata and registration, and writes `verifiedAt`, run before each release, so a stale endpoint shows up as a diff rather than as a user's failed connection.

## Icons

Ship icons with the directory rather than fetching them per user.

- **Sources, in order:** svgl, gilbarbara/logos (`*-icon.svg`, CC0), thesvg (only icons whose own license is CC0 or MIT), lobe-icons for AI vendors, homarr-labs dashboard-icons, then App Store artwork (1024px, checked by seller), the site's apple-touch-icon or SVG favicon, and the favicon proxy last. A hand-set override always wins.
- **Coverage measured:** svgl, gilbarbara and thesvg together give a usable full-color square mark for 91 of 127 entries and 27 of the 32 weak ones; with App Store and site icons, 118. Wordmarks, outdated marks and same-name products were rejected by eye.
- **Pipeline:** a checked-in manifest from slug to source, pinned upstream version, license and override; a refresh script that fetches, runs svgo, pads to a square viewBox, and writes a contact sheet so a review approves images rather than paths. About 0.6 MB for the whole set.
- **Trademarks:** the collections license the files, not the marks. Showing a mark to name the integration is the ordinary use; recoloring or redrawing one is not, so marks go on the plate as published.

An agent-drawn icon (`app icon`) stays the answer for anything outside the directory and for local servers with no Mac app.

## Ideas from Craft Agents worth taking

Craft's sources are the model the apps feature was built on. Since then they added, and we lack:

- `app test` and real calls building credentials through the same code, with the error body shown on 400/401/403, so a green test means calls work.
- A token refresh attempt in the test, and a source with no credential never shown as connected.
- Reading an app's guide as a precondition for its first call, with one soft refusal.
- A fallback client when dynamic registration is refused, and the OAuth `resource` parameter on authorize, token and refresh for resource-bound servers.
- An icon probe at set-up time (`/favicon.svg`, `/apple-touch-icon.png`, the page's icon links, largest first), saved into the folder.

## Vendor work with lead time

Featuring Google, Microsoft, Slack, Zoom, Asana and HubSpot means registering Instrument's own OAuth clients now, since several queues take weeks: Google brand verification and sensitive scopes (Calendar) take days to weeks, restricted scopes (Gmail read, full Drive) need a security assessment; Microsoft publisher verification needs a partner account; Slack and Zoom need marketplace review. Asana and HubSpot are self-serve. Until a client clears, the entry's first way in is the browser.
