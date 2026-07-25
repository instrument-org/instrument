import { toSupportedLanguage } from "@/client/lib/file-extension-to-language";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

import { useTheme } from "../components/theme-provider";

// Highlighting round-trips the whole input through the highlighter and injects
// a per-token DOM node for every line at once, so its cost scales with input
// size; large inputs (e.g. a 50k-row generated CSV) freeze the view. Past this
// size we skip highlighting, leaving the caller's plain-text rendering.
const MAX_SYNTAX_HIGHLIGHT_CHARS = 512 * 1024;

export function useSyntaxHighlighting({
  code,
  language,
}: {
  code: string | undefined;
  language: string | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const highlightableCode =
    code && code.length <= MAX_SYNTAX_HIGHLIGHT_CHARS ? code : undefined;

  const { data: supportedLanguages } = useQuery(
    rpcClient.syntax.supportedLanguages.queryOptions({
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );

  const validLanguage =
    language && supportedLanguages
      ? toSupportedLanguage(language, supportedLanguages)
      : undefined;

  const { data: highlightedHtml } = useQuery(
    rpcClient.syntax.highlightCode.queryOptions({
      input:
        validLanguage && highlightableCode
          ? {
              code: highlightableCode,
              lang: validLanguage,
              theme: resolvedTheme === "dark" ? "dark" : "light",
            }
          : skipToken,
      placeholderData: (previousData) => previousData,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );

  return {
    highlightedHtml:
      validLanguage && highlightableCode ? highlightedHtml : undefined,
    /** Whether highlighted output is coming, so callers can hold a fallback. */
    isHighlightable: !!validLanguage && !!highlightableCode,
    isLanguageSupported: !!validLanguage,
    supportedLanguages,
  };
}
