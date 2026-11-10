import { describe, expect, it } from "vitest";

import { decodeFileText, encodeFileText, textToShow } from "./text-encoding";

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
/** Text in Latin-1's range as Windows-1252 bytes, one byte a character. */
const latin1 = (s: string) =>
  Uint8Array.from(Array.from(s, (char) => char.charCodeAt(0)));

describe("decodeFileText", () => {
  it.each([
    ["UTF-8", new TextEncoder().encode("café"), "utf-8", "café"],
    [
      "UTF-8 with a byte-order mark",
      hex("efbbbf68656c6c6f"),
      "utf-8",
      "\uFEFFhello",
    ],
    ["UTF-16LE", hex("fffe630061006600e900"), "utf-16le", "\uFEFFcafé"],
    ["UTF-16BE", hex("feff00630061006600e9"), "utf-16be", "\uFEFFcafé"],
  ])("reads %s as saveable", (_name, bytes, encoding, text) => {
    expect(decodeFileText(bytes)).toEqual({ encoding, saveable: true, text });
  });

  it("reads the start of a UTF-8 file cut mid-character as UTF-8", () => {
    expect(decodeFileText(hex("636166c3"), true)).toEqual({
      encoding: "utf-8",
      saveable: true,
      text: "caf",
    });
  });

  it("reads a UTF-16 file cut mid-character, but not as saveable", () => {
    expect(decodeFileText(hex("fffe630061"))).toEqual({
      encoding: "utf-16le",
      saveable: false,
      text: "\uFEFFc\uFFFD",
    });
  });

  it.each([
    ["Café rewritten in Latin-1", "windows-1252"],
    ["résumé naïve", "windows-1252"],
    ["Die Größe der Straße ist schön. Über alles.", "windows-1252"],
    ["Ça va? Où est la gare? Très bien, merci.", "windows-1252"],
    ["El niño comió jamón en España, señor.", "windows-1252"],
    ["ÅÄÖ Ålesund Ärlig Öland", "windows-1252"],
  ])("reads Western text %j in Windows-1252", (text, encoding) => {
    expect(decodeFileText(latin1(text))).toEqual({
      encoding,
      saveable: false,
      text,
    });
  });

  it.each([
    ["shift_jis", "こんにちは、世界", "82b182f182c982bf82cd814190a28a45"],
    [
      "shift_jis",
      "会議のメモ\n- 来週の予定を確認する",
      "89ef8b6382cc838183820a2d2097888f5482cc975c92e882f08a6d944682b782e9",
    ],
    [
      "euc-jp",
      "日本語のテキストファイルです。",
      "c6fccbdcb8eca4cea5c6a5ada5b9a5c8a5d5a5a1a5a4a5eba4c7a4b9a1a3",
    ],
    [
      "gb18030",
      "会议记录：下周确认日程，发送资料。",
      "bbe1d2e9bcc7c2bca3bacfc2d6dcc8b7c8cfc8d5b3cca3acb7a2cbcdd7cac1cfa1a3",
    ],
    [
      "big5",
      "這是一個中文文字檔案。",
      "b36fac4fa440add3a4a4a4e5a4e5a672c0c9aed7a143",
    ],
    [
      "euc-kr",
      "한국어 텍스트 파일입니다.",
      "c7d1b1b9beee20c5d8bdbac6ae20c6c4c0cfc0d4b4cfb4d92e",
    ],
    [
      "windows-1251",
      "Привет, мир! Это текст.",
      "cff0e8e2e5f22c20ece8f02120ddf2ee20f2e5eaf1f22e",
    ],
  ])("reads %s text %j in its encoding, read only", (encoding, text, bytes) => {
    expect(decodeFileText(hex(bytes))).toEqual({
      encoding,
      saveable: false,
      text,
    });
  });
});

describe("encodeFileText", () => {
  it.each([
    ["utf-8", "\uFEFFcafé", "efbbbf636166c3a9"],
    ["utf-16le", "\uFEFFcafé", "fffe630061006600e900"],
    ["utf-16be", "\uFEFFcafé", "feff00630061006600e9"],
    ["utf-16le", "café", "fffe630061006600e900"],
  ] as const)(
    "writes %s text %j as its file's bytes",
    (encoding, text, bytes) => {
      expect(Buffer.from(encodeFileText(text, encoding)).toString("hex")).toBe(
        bytes,
      );
    },
  );

  it("writes a UTF-16 file back byte for byte", () => {
    const bytes = hex("fffe3dd838de0a00");
    const read = decodeFileText(bytes);
    expect(read.text).toBe("\uFEFF😸\n");
    expect(encodeFileText(read.text, "utf-16le")).toEqual(bytes);
  });
});

describe("textToShow", () => {
  it.each([
    ["UTF-8 with a byte-order mark", "efbbbf68656c6c6f", "hello"],
    ["UTF-16LE", "fffe630061006600e900", "café"],
    ["Shift JIS", "82b182f182c982bf82cd814190a28a45", "こんにちは、世界"],
  ])("shows %s without its byte-order mark", (_name, bytes, text) => {
    expect(textToShow(hex(bytes))).toBe(text);
  });
});
