/**
 * Does a chat that takes screenshot after screenshot keep working once its
 * images outgrow one request?
 *
 * Every screenshot an agent-browser call takes comes back with its result,
 * and every later request carries it again, so a long browsing session
 * reaches a provider's request limits without anyone choosing to. Each page
 * here draws its word on a canvas, out of reach of a snapshot or the page's
 * text, so the only way to read it is to look.
 *
 * `browser-screenshots-heavy` draws on noise, which no image format can
 * compress, so each screenshot is several megabytes and the request passes
 * the image byte budget within a few pages: the oldest are left out of the
 * request and the chat answers on. `browser-screenshots-light` draws on a
 * flat color, so the images stay small and many, twenty in the context at
 * once. Under `INSTRUMENT_CONTEXT_LENGTH_OVERRIDE` the window rolls over with
 * images in it; at 40k or 60k a model stops to write handoff notes long before
 * the twentieth page, so read such a run for refusals rather than the words.
 */
import http from "node:http";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const WORDS = [
  "ANCHOR",
  "BISCUIT",
  "CANYON",
  "DYNAMO",
  "EMBER",
  "FALCON",
  "GLACIER",
  "HARBOR",
  "IGLOO",
  "JUNIPER",
  "KESTREL",
  "LANTERN",
  "MEADOW",
  "NECTAR",
  "ORCHID",
  "PEBBLE",
  "QUARTZ",
  "RAVEN",
  "SAFFRON",
  "TUNDRA",
];

function page(word: string, noise: boolean): string {
  return `<!doctype html><html><head><title>Page</title>
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block}</style></head>
<body><canvas id="c"></canvas><script>
const canvas = document.getElementById("c");
canvas.width = innerWidth; canvas.height = innerHeight;
const g = canvas.getContext("2d");
if (${JSON.stringify(noise)}) {
  const image = g.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i++) image.data[i] = (i % 4 === 3) ? 255 : Math.random() * 256;
  g.putImageData(image, 0, 0);
} else {
  g.fillStyle = "#cde"; g.fillRect(0, 0, canvas.width, canvas.height);
}
g.fillStyle = "#000"; g.fillRect(canvas.width / 2 - 260, canvas.height / 2 - 80, 520, 160);
g.fillStyle = "#fff"; g.font = "bold 96px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
g.fillText(${JSON.stringify(word)}, canvas.width / 2, canvas.height / 2);
</script></body></html>`;
}

let site = "";

async function serveSite(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const match = /^\/(heavy|light)\/(\d+)$/.exec(url.pathname);
    const word = match ? WORDS[Number(match[2]) - 1] : undefined;
    if (!match || word === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page(word, match[1] === "heavy"));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("The site has no port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function prompt(kind: "heavy" | "light", count: number): string {
  return `Pages ${site}/${kind}/1 through ${site}/${kind}/${count} each show one word, drawn as a picture, so it is not in the page's text. Go through them in order, one page at a time, read each word from a screenshot of that page, and give me all ${count} words in order.`;
}

/** How many bash results carried a screenshot, and their total size as sent. */
function screenshots(sessions: Session.WithMessagesAndParts[]) {
  const shown = sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" &&
        part.state === "output-available" &&
        part.output.screenshot !== undefined
          ? [part.output.screenshot]
          : [],
      ),
    ),
  );
  const bytes = shown.reduce(
    (sum, shot) => sum + (shot.base64Data?.length ?? 0),
    0,
  );
  return { bytes, count: shown.length };
}

function reply(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ),
    )
    .join("\n");
}

function namedEveryWord(count: number): Assertion {
  const text = `Named all ${count} words`;
  return {
    check: ({ sessions }) => {
      const answer = reply(sessions).toUpperCase();
      const missing = WORDS.slice(0, count).filter(
        (word) => !answer.includes(word),
      );
      const shots = screenshots(sessions);
      return {
        evidence: `${shots.count} screenshots shown, ${(shots.bytes / 1024 / 1024).toFixed(1)} MB as stored; missing: ${missing.join(", ") || "none"}`,
        passed: missing.length === 0,
        text,
      };
    },
    text,
  };
}

/** Images the model was shown: screenshots in bash results and images read back. */
function imagesSeen(sessions: Session.WithMessagesAndParts[]): number {
  const reads = sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.filter(
        (part) =>
          part.type === "tool-read_file" &&
          part.state === "output-available" &&
          /\.(?:png|jpe?g|webp)$/i.test(part.input?.filePath ?? ""),
      ),
    ),
  );
  return screenshots(sessions).count + reads.length;
}

const sawImages = (least: number): Assertion => {
  const text = `Was shown at least ${least} images of the pages`;
  return {
    check: ({ sessions }) => {
      const count = imagesSeen(sessions);
      return { evidence: `${count}`, passed: count >= least, text };
    },
    text,
  };
};

export const IMAGE_BUDGET_EVALS = [
  defineEval({
    assertions: [sawImages(10), namedEveryWord(12)],
    name: "browser-screenshots-heavy",
    get prompt() {
      return prompt("heavy", 12);
    },
    setup: async () => {
      site ||= await serveSite();
    },
  }),

  defineEval({
    assertions: [sawImages(16), namedEveryWord(20)],
    name: "browser-screenshots-light",
    get prompt() {
      return prompt("light", 20);
    },
    setup: async () => {
      site ||= await serveSite();
    },
  }),
];
