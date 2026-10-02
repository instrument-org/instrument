import { getHighlighter } from "@/electron-main/lib/shiki-highlighter";
import { base } from "@/electron-main/rpc/base";
import { type BundledLanguage, bundledLanguages } from "shiki";
import { z } from "zod";

const SHIKI_THEMES = {
  dark: "github-dark-default",
  light: "github-light-default",
} as const;

const bundledLanguageKeys = Object.keys(bundledLanguages) as [
  BundledLanguage,
  ...BundledLanguage[],
];
const languageSchema = z.enum(bundledLanguageKeys);

const highlightCode = base
  .input(
    z.object({
      code: z.string(),
      lang: languageSchema,
      theme: z.enum(["light", "dark"]),
    }),
  )
  .output(z.array(z.string()))
  .handler(async ({ input }) => {
    const highlighter = await getHighlighter();

    const loadedLanguages = highlighter.getLoadedLanguages();
    if (!loadedLanguages.includes(input.lang)) {
      // Lazy load languages to avoid upfront performance penalty.
      await highlighter.loadLanguage(bundledLanguages[input.lang]);
    }

    return highlighter
      .codeToHtml(input.code, {
        lang: input.lang,
        theme: SHIKI_THEMES[input.theme],
        transformers: [
          {
            name: "remove-background",
            pre: (node) => {
              node.properties.style &&= (
                node.properties.style as string
              ).replaceAll(/background-color:[^;]+;?/g, "");
            },
          },
        ],
      })
      .split("\n");
  });

const supportedLanguages = base.output(z.array(languageSchema)).handler(() => {
  return bundledLanguageKeys;
});

export const syntax = {
  highlightCode,
  supportedLanguages,
};
