import { describe, expect, it } from "vitest";

import {
  type FailedLoadCopy,
  failedLoadCopy,
  isEmptyResponseDocument,
  isResponseDocument,
} from "./failed-load-copy";

const url = "https://shop.example.com/cart";
/** The notice as one line: heading | summary | code. */
const said = ({ code, heading, summary }: FailedLoadCopy) =>
  `${heading} | ${summary} | ${code}`;

describe("failedLoadCopy", () => {
  it.each([
    [
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "This site can’t be reached | The server for shop.example.com couldn’t be found. | ERR_NAME_NOT_RESOLVED",
    ],
    [
      -102,
      "ERR_CONNECTION_REFUSED",
      "This site can’t be reached | shop.example.com refused to connect. | ERR_CONNECTION_REFUSED",
    ],
    [
      -118,
      "ERR_CONNECTION_TIMED_OUT",
      "This site can’t be reached | shop.example.com took too long to respond. | ERR_CONNECTION_TIMED_OUT",
    ],
    [
      -7,
      "ERR_TIMED_OUT",
      "This site can’t be reached | shop.example.com took too long to respond. | ERR_TIMED_OUT",
    ],
    [
      -101,
      "ERR_CONNECTION_RESET",
      "This site can’t be reached | The connection was reset. | ERR_CONNECTION_RESET",
    ],
    [
      -100,
      "ERR_CONNECTION_CLOSED",
      "This site can’t be reached | shop.example.com closed the connection unexpectedly. | ERR_CONNECTION_CLOSED",
    ],
    [
      -106,
      "ERR_INTERNET_DISCONNECTED",
      "No internet | Your computer isn’t connected to the internet. Check your network, then reload. | ERR_INTERNET_DISCONNECTED",
    ],
    [
      -109,
      "ERR_ADDRESS_UNREACHABLE",
      "This site can’t be reached | https://shop.example.com/cart can’t be reached. | ERR_ADDRESS_UNREACHABLE",
    ],
    [
      -310,
      "ERR_TOO_MANY_REDIRECTS",
      "This page isn’t working | shop.example.com redirected you too many times. | ERR_TOO_MANY_REDIRECTS",
    ],
    [
      -324,
      "ERR_EMPTY_RESPONSE",
      "This page isn’t working | shop.example.com didn’t send any data. | ERR_EMPTY_RESPONSE",
    ],
    [
      -21,
      "ERR_NETWORK_CHANGED",
      "This site can’t be reached | The page at https://shop.example.com/cart might be down right now, or it may have moved to a new address. | ERR_NETWORK_CHANGED",
    ],
    [
      -999,
      "",
      "This site can’t be reached | The page at https://shop.example.com/cart might be down right now, or it may have moved to a new address. | Error -999",
    ],
  ])("%i %s", (errorCode, errorDescription, expected) => {
    expect(said(failedLoadCopy({ errorCode, errorDescription, url }))).toBe(
      expected,
    );
  });

  it("names the host without its port, as Chrome does", () => {
    expect(
      failedLoadCopy({
        errorCode: -102,
        errorDescription: "ERR_CONNECTION_REFUSED",
        url: "http://127.0.0.1:9/",
      }).summary,
    ).toMatchInlineSnapshot(`"127.0.0.1 refused to connect."`);
  });

  it.each([
    [
      403,
      "Access to shop.example.com was denied | You don’t have permission to see this page. | HTTP ERROR 403",
    ],
    [
      404,
      "This shop.example.com page can’t be found | There’s no page at https://shop.example.com/cart. | HTTP ERROR 404",
    ],
    [
      410,
      "This shop.example.com page can’t be found | It may have been moved or deleted. | HTTP ERROR 410",
    ],
    [
      500,
      "This page isn’t working | shop.example.com can’t handle this request right now. | HTTP ERROR 500",
    ],
    [
      503,
      "This page isn’t working | shop.example.com can’t handle this request right now. | HTTP ERROR 503",
    ],
    [
      504,
      "This page isn’t working | shop.example.com took too long to respond. | HTTP ERROR 504",
    ],
    [
      418,
      "This page isn’t working | If this keeps happening, contact the site’s owner. | HTTP ERROR 418",
    ],
  ])("HTTP %i with nothing in it", (httpStatus, expected) => {
    expect(said(failedLoadCopy({ httpStatus, url }))).toBe(expected);
  });
});

describe("isEmptyResponseDocument", () => {
  it.each([
    ["an empty text/html body", { body: "", head: "" }, true],
    [
      "an empty text/plain body",
      {
        body: '<pre style="word-wrap: break-word; white-space: pre-wrap;"></pre>',
        head: '<meta name="color-scheme" content="light dark">',
      },
      true,
    ],
    ["a styled 404 page", { body: "<h1>Not found</h1>", head: "" }, false],
    [
      "a page with only a stylesheet",
      { body: "", head: "<style>body{background:red}</style>" },
      false,
    ],
    [
      "a text/plain body with words",
      { body: "<pre>Not found</pre>", head: "" },
      false,
    ],
    [
      "a page drawn by a script",
      { body: "<script>draw()</script>", head: "" },
      false,
    ],
  ])("%s: %s", (_name, doc, expected) => {
    expect(isEmptyResponseDocument(doc)).toBe(expected);
  });

  it.each([
    [{ body: "", head: "" }, true],
    [{ body: "" }, false],
    [null, false],
    ["<html></html>", false],
  ])("reads %o as a document: %s", (value, expected) => {
    expect(isResponseDocument(value)).toBe(expected);
  });
});
