import http from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchPageTitle, isPublicPage, titleIn } from "./page-title-fetch";

describe("isPublicPage", () => {
  it.each([
    ["https://www.giro.com/product/helmet", true],
    ["http://93.184.215.14/", true],
    ["http://localhost:3000/", false],
    ["http://app.localhost/", false],
    ["http://printer.local/", false],
    ["http://intranet/", false],
    ["http://127.0.0.1:8080/", false],
    ["http://192.168.1.1/", false],
    ["http://10.0.0.5/", false],
    ["http://172.20.0.1/", false],
    ["http://[::1]/", false],
    ["https://user:secret@example.com/", false],
    ["ftp://example.com/", false],
  ])("%s is %s", (url, expected) => {
    expect(isPublicPage(url)).toBe(expected);
  });
});

describe("titleIn", () => {
  it.each([
    [
      "<title>Caf&eacute; de Flore &ndash; Wikipedia</title>",
      "Café de Flore – Wikipedia",
    ],
    ["<title>\n  Spread\n  over lines </title>", "Spread over lines"],
    ["<svg><title>An icon</title></svg><title>The page</title>", "The page"],
    ["<title></title>", undefined],
    ["<p>No title</p>", undefined],
  ])("reads %s", (html, expected) => {
    expect(titleIn(html)).toBe(expected);
  });
});

describe("fetchPageTitle", () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url === "/page") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        // The rest of the page never comes; the title is all that is read.
        response.write("<html><head><title>A page</title></head><body>");
        return;
      }
      if (request.url === "/data") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"title":"no"}');
        return;
      }
      response.writeHead(404, { "content-type": "text/html" });
      response.end("<title>Not Found</title>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port.toString()}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("reads the title without waiting for the rest of the page", async () => {
    expect(await fetchPageTitle(`${origin}/page`, "test")).toBe("A page");
  });

  it.each(["/data", "/missing"])("finds no title at %s", async (path) => {
    expect(await fetchPageTitle(`${origin}${path}`, "test")).toBeUndefined();
  });
});
