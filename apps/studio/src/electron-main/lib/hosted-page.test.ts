import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fetchHostedPage,
  hostedPageStem,
  hostedPageUrl,
  keepHostedPage,
} from "./hosted-page";

// A hosted page is fetched from its own host and no other, and kept in the
// person's Downloads folder under its title, the way their browser would
// keep it.

const PAGE = "<!doctype html><title>Weekly plan: Q4</title><p>Go.</p>";

/** What the host answers, by the address asked. */
type Answers = Record<string, () => Response>;

/** A fetch that answers from `answers` and remembers what it was asked. */
function host(answers: Answers) {
  const asked: { init: RequestInit | undefined; url: string }[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    asked.push({ init, url });
    const answer = answers[url];
    return Promise.resolve(
      answer ? answer() : new Response("", { status: 404 }),
    );
  }) as typeof globalThis.fetch;
  return { asked, fetch };
}

const page = () =>
  new Response(PAGE, { headers: { "content-type": "text/html" }, status: 200 });

describe("fetchHostedPage", () => {
  it("asks the page's own host for HTML, following no redirect on its own", async () => {
    const { asked, fetch } = host({ [hostedPageUrl("weekly")]: page });
    const fetched = await fetchHostedPage("weekly", { fetch });
    expect("body" in fetched && new TextDecoder().decode(fetched.body)).toBe(
      PAGE,
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe("https://weekly.instrument.page/");
    expect(asked[0]?.init).toMatchObject({
      headers: { accept: "text/html" },
      redirect: "manual",
    });
  });

  it("follows a redirect that stays on the host", async () => {
    const { asked, fetch } = host({
      [hostedPageUrl("weekly")]: () =>
        new Response("", { headers: { location: "/index.html" }, status: 302 }),
      "https://weekly.instrument.page/index.html": page,
    });
    expect(await fetchHostedPage("weekly", { fetch })).toHaveProperty("body");
    expect(asked.map((each) => each.url)).toEqual([
      "https://weekly.instrument.page/",
      "https://weekly.instrument.page/index.html",
    ]);
  });

  it.each([
    ["another host", "https://evil.example/"],
    ["another page's host", "https://other.instrument.page/"],
    ["the pages domain itself", "https://instrument.page/weekly"],
    ["the host over plain http", "http://weekly.instrument.page/"],
  ])("goes nowhere when sent to %s", async (_case, location) => {
    const { asked, fetch } = host({
      [hostedPageUrl("weekly")]: () =>
        new Response("", { headers: { location }, status: 301 }),
      [location]: page,
    });
    expect(await fetchHostedPage("weekly", { fetch })).toEqual({
      failed: "sent the request elsewhere",
    });
    expect(asked).toHaveLength(1);
  });

  it("gives up on a host that keeps redirecting", async () => {
    const { asked, fetch } = host({
      [hostedPageUrl("weekly")]: () =>
        new Response("", { headers: { location: "/" }, status: 302 }),
    });
    expect(await fetchHostedPage("weekly", { fetch })).toEqual({
      failed: "sent the request elsewhere",
    });
    expect(asked).toHaveLength(4);
  });

  it.each([404, 500, 204])("fails on an answer of %i", async (status) => {
    const { fetch } = host({
      [hostedPageUrl("weekly")]: () => new Response(null, { status }),
    });
    expect(await fetchHostedPage("weekly", { fetch })).toEqual({
      failed: `answered ${status.toString()}`,
    });
  });

  it("fails on a page the host says is too large", async () => {
    const { fetch } = host({
      [hostedPageUrl("weekly")]: () =>
        new Response("", {
          headers: { "content-length": (17 * 1024 * 1024).toString() },
          status: 200,
        }),
    });
    expect(await fetchHostedPage("weekly", { fetch })).toEqual({
      failed: "is too large",
    });
  });

  it("stops reading a page that runs too large", async () => {
    let sent = 0;
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent >= 8) {
          controller.close();
        }
      },
    });
    const { fetch } = host({
      [hostedPageUrl("weekly")]: () => new Response(body, { status: 200 }),
    });
    expect(await fetchHostedPage("weekly", { fetch })).toEqual({
      failed: "is too large",
    });
    expect(sent).toBeLessThan(8);
  });

  it("gives up on a host that does not answer in time", async () => {
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted due to timeout"));
        });
      })) as typeof globalThis.fetch;
    expect(await fetchHostedPage("weekly", { fetch, timeoutMs: 20 })).toEqual({
      failed: "did not answer in time",
    });
  });

  it("says when the host cannot be reached", async () => {
    const fetch = (() =>
      Promise.reject(
        new Error("getaddrinfo ENOTFOUND"),
      )) as typeof globalThis.fetch;
    expect(await fetchHostedPage("weekly", { fetch })).toEqual({
      failed: "could not be reached: getaddrinfo ENOTFOUND",
    });
  });
});

describe("hostedPageStem", () => {
  const stem = (html: string) =>
    hostedPageStem("weekly", new TextEncoder().encode(html));

  it.each([
    ["its title", "<title> Weekly plan: Q4 </title>", "Weekly plan Q4"],
    ["an entity in the title", "<title>Q&amp;A</title>", "Q&A"],
    ["its first heading when it has no title", "<h1>Plan</h1>", "Plan"],
    ["its id when it names itself nothing", "<p>words</p>", "weekly"],
    [
      "its id when nothing of the title can be a name",
      "<title>???</title>",
      "weekly",
    ],
    [
      "its id when the title is a device's name",
      "<title>CON</title>",
      "weekly",
    ],
  ])("names a page by %s", (_case, html, expected) => {
    expect(stem(html)).toBe(expected);
  });
});

describe("keepHostedPage", () => {
  let folder: string;
  let downloads: string;
  const body = new TextEncoder().encode(PAGE);

  beforeEach(async () => {
    folder = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "hosted-page-")),
    );
    downloads = path.join(folder, "Downloads");
  });

  afterEach(async () => {
    await fs.rm(folder, { force: true, recursive: true });
  });

  const keep = (
    mark: (file: string) => Promise<void> = () => Promise.resolve(),
  ) => keepHostedPage("weekly", body, { downloads: () => downloads, mark });

  it("writes the page into Downloads under its title, making the folder", async () => {
    expect(await keep()).toBe(path.join(downloads, "Weekly plan Q4.html"));
    expect(
      await fs.readFile(path.join(downloads, "Weekly plan Q4.html"), "utf8"),
    ).toBe(PAGE);
  });

  it("numbers a copy whose name is taken, as a browser does", async () => {
    expect(await keep()).toBe(path.join(downloads, "Weekly plan Q4.html"));
    expect(await keep()).toBe(path.join(downloads, "Weekly plan Q4 (2).html"));
    expect(await keep()).toBe(path.join(downloads, "Weekly plan Q4 (3).html"));
  });

  it("marks the copy as downloaded from the internet", async () => {
    const marked: string[] = [];
    const kept = await keep((file) => {
      marked.push(file);
      return Promise.resolve();
    });
    expect(marked).toEqual([kept]);
  });

  it("keeps the copy when the mark cannot be written", async () => {
    const kept = await keep(() => Promise.reject(new Error("no xattr")));
    expect(await fs.readFile(kept, "utf8")).toBe(PAGE);
  });

  it("names the folder where it really is", async () => {
    await fs.mkdir(downloads);
    const link = path.join(folder, "Pile");
    await fs.symlink(downloads, link);
    expect(
      await keepHostedPage("weekly", body, {
        downloads: () => link,
        mark: () => Promise.resolve(),
      }),
    ).toBe(path.join(downloads, "Weekly plan Q4.html"));
  });

  it("rejects when Downloads takes no file", async () => {
    await fs.writeFile(downloads, "");
    await expect(keep()).rejects.toThrow();
  });
});
