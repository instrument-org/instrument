#!/usr/bin/env bash

set -euo pipefail

CHROME_DEVTOOLS=(pnpm exec chrome-devtools)

browser_url="${1:-http://127.0.0.1:48160}"
page_hint="${2:-}"

BROWSER_URL="$browser_url" node << 'NODE'
const browserUrl = process.env.BROWSER_URL;

const probe = async (path) => {
  const response = await fetch(`${browserUrl}${path}`);
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
  console.error(`[error] Could not reach ${browserUrl}: ${error.message}`);
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
