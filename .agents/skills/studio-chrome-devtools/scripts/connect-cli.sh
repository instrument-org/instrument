#!/usr/bin/env bash

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CHROME_DEVTOOLS=(
  env
  CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1
  CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1
  pnpm exec chrome-devtools
)

# This checkout's instance, not 48160: that one is the conventional port and is
# almost always a window a person is using.
if [[ -n "${1:-}" ]]; then
  browser_url="$1"
else
  browser_url="http://127.0.0.1:$(node "${HERE}/studio-drive.mjs" port)"
fi
page_hint="${2:-}"

BROWSER_URL="$browser_url" node << 'NODE'
const browserUrl = process.env.BROWSER_URL;
const timeoutMs = 5_000;

const probe = async (path) => {
  const response = await fetch(`${browserUrl}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  const body = await response.text();
  if (path === "/json/list") {
    const pages = JSON.parse(body);
    console.log(`[ok] ${path} -> ${pages.length} page(s)`);
  } else {
    console.log(`[ok] ${path}`);
  }
};

const main = async () => {
  await probe("/json/version");
  await probe("/json/list");
};

main().catch((error) => {
  const detail =
    error.name === "TimeoutError"
      ? `timed out after ${timeoutMs / 1_000} seconds; another Studio process may own the port without responding`
      : error.message;

  console.error(`[error] Could not reach ${browserUrl}: ${detail}`);
  process.exit(1);
});
NODE

echo "[info] Starting chrome-devtools bridge for ${browser_url}"
"${CHROME_DEVTOOLS[@]}" start --browserUrl "${browser_url}" > /dev/null

set +e
pages_json="$("${CHROME_DEVTOOLS[@]}" list_pages --output-format=json 2>&1)"
status=$?
set -e

if [[ $status -ne 0 ]]; then
  echo "${pages_json}" >&2

  if [[ "${pages_json}" == *"ENOENT"* ]] \
    && [[ "${pages_json}" == *"chrome-devtools-mcp"* ]]; then
    cat >&2 << 'EOF'
[error] The CLI daemon socket could not be reached.
[hint] Re-run this script outside the sandbox.
[hint] In Cursor Shell calls, use required_permissions: ["all"].
EOF
  fi

  exit "${status}"
fi

echo "${pages_json}"

if [[ -z "${page_hint}" ]]; then
  exit 0
fi

page_id="$(
  PAGES_JSON="${pages_json}" PAGE_HINT="${page_hint}" node << 'NODE'
const payload = JSON.parse(process.env.PAGES_JSON);
const hint = process.env.PAGE_HINT;

const match = payload.pages.find((page) => {
  return !page.url.startsWith("data:text/html") && page.url.includes(hint);
});

if (match) {
  process.stdout.write(String(match.id));
}
NODE
)"

if [[ -z "${page_id}" ]]; then
  echo "[warn] No page matched ${page_hint}"
  exit 0
fi

echo "[info] Selecting page ${page_id} matching ${page_hint}"
"${CHROME_DEVTOOLS[@]}" select_page "${page_id}" --bringToFront true > /dev/null
"${CHROME_DEVTOOLS[@]}" take_snapshot
