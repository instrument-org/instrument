/**
 * What a tab says in place of a page that didn't load, in Chrome's words
 * and grouping: the table in Chromium's
 * `components/error_page/common/localized_error.cc` (`net_error_options`,
 * `http_error_options`, `generic_4xx_5xx_error`) over the strings in
 * `components/error_page_strings.grdp`. The code goes small under the
 * sentence, as Chrome prints it.
 */
export interface FailedLoadCopy {
  /** `ERR_CONNECTION_REFUSED`, or `HTTP ERROR 500`. */
  code: string;
  heading: string;
  summary: string;
}

/** A load that failed: Chromium's net error, or an HTTP error with nothing in it. */
export type FailedLoad =
  | { errorCode: number; errorDescription: string; url: string }
  | { httpStatus: number; url: string };

const NOT_AVAILABLE = "This site can’t be reached";
const PAGE_NOT_WORKING = "This page isn’t working";

/** Chromium's net error codes the notice has words of its own for. */
const NET_ERRORS: Record<
  number,
  { heading: string; summary: (host: string, url: string) => string }
> = {
  [-7]: {
    heading: NOT_AVAILABLE,
    summary: (host) => `${host} took too long to respond.`,
  },
  [-100]: {
    heading: NOT_AVAILABLE,
    summary: (host) => `${host} closed the connection unexpectedly.`,
  },
  [-101]: {
    heading: NOT_AVAILABLE,
    summary: () => "The connection was reset.",
  },
  [-102]: {
    heading: NOT_AVAILABLE,
    summary: (host) => `${host} refused to connect.`,
  },
  [-104]: {
    heading: NOT_AVAILABLE,
    summary: (host) => `${host} can’t be reached right now.`,
  },
  [-105]: {
    heading: NOT_AVAILABLE,
    summary: (host) => `The server for ${host} couldn’t be found.`,
  },
  [-106]: {
    heading: "No internet",
    summary: () =>
      "Your computer isn’t connected to the internet. Check your network, then reload.",
  },
  [-109]: {
    heading: NOT_AVAILABLE,
    summary: (_host, url) => `${url} can’t be reached.`,
  },
  [-118]: {
    heading: NOT_AVAILABLE,
    summary: (host) => `${host} took too long to respond.`,
  },
  [-310]: {
    heading: PAGE_NOT_WORKING,
    summary: (host) => `${host} redirected you too many times.`,
  },
  [-320]: {
    heading: PAGE_NOT_WORKING,
    summary: (host) => `${host} sent a response the browser couldn’t read.`,
  },
  [-324]: {
    heading: PAGE_NOT_WORKING,
    summary: (host) => `${host} didn’t send any data.`,
  },
  [-354]: {
    heading: PAGE_NOT_WORKING,
    summary: (host) => `${host} closed the connection unexpectedly.`,
  },
  [-355]: {
    heading: PAGE_NOT_WORKING,
    summary: (host) => `${host} closed the connection unexpectedly.`,
  },
};

export function failedLoadCopy(failure: FailedLoad): FailedLoadCopy {
  const parsed = URL.parse(failure.url);
  const host = parsed?.hostname || failure.url;
  if ("httpStatus" in failure) {
    return {
      code: `HTTP ERROR ${failure.httpStatus}`,
      ...httpErrorCopy(failure.httpStatus, host, failure.url),
    };
  }
  const known = NET_ERRORS[failure.errorCode];
  return {
    code:
      failure.errorDescription.replace(/^net::/, "") ||
      `Error ${failure.errorCode}`,
    heading: known?.heading ?? NOT_AVAILABLE,
    summary:
      known?.summary(host, failure.url) ??
      `The page at ${failure.url} might be down right now, or it may have moved to a new address.`,
  };
}

function httpErrorCopy(status: number, host: string, url: string) {
  switch (status) {
    case 403: {
      return {
        heading: `Access to ${host} was denied`,
        summary: "You don’t have permission to see this page.",
      };
    }
    case 404: {
      return {
        heading: `This ${host} page can’t be found`,
        summary: `There’s no page at ${url}.`,
      };
    }
    case 410: {
      return {
        heading: `This ${host} page can’t be found`,
        summary: "It may have been moved or deleted.",
      };
    }
    case 500:
    case 501:
    case 502:
    case 503: {
      return {
        heading: PAGE_NOT_WORKING,
        summary: `${host} can’t handle this request right now.`,
      };
    }
    case 504: {
      return {
        heading: PAGE_NOT_WORKING,
        summary: `${host} took too long to respond.`,
      };
    }
    default: {
      return {
        heading: PAGE_NOT_WORKING,
        summary: "If this keeps happening, contact the site’s owner.",
      };
    }
  }
}

/**
 * Whether a page committed from an HTTP error response had nothing in it,
 * read from its document's head and body as the guest parsed them. Chrome
 * shows its own error page for a 4xx or 5xx main-frame response with an
 * empty body (`HttpErrorNavigationThrottle`), which Electron's content
 * client never asks for, so the empty document commits instead. An empty
 * body parses to an empty head and body, or for text/plain to a body
 * holding one empty `<pre>` and a head holding only Chromium's color-scheme
 * meta. Leading whitespace parses away too, so a body of only whitespace
 * reads as empty here where Chrome would show it.
 */
export function isEmptyResponseDocument(doc: {
  body: string;
  head: string;
}): boolean {
  const head = doc.head.replace(/<meta name="color-scheme"[^>]*>/, "").trim();
  const body = doc.body.replace(/^<pre[^>]*><\/pre>$/, "").trim();
  return head === "" && body === "";
}

/** Whether what the guest handed back is the shape {@link READ_RESPONSE_DOCUMENT} makes. */
export function isResponseDocument(
  value: unknown,
): value is { body: string; head: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "body" in value &&
    "head" in value &&
    typeof value.body === "string" &&
    typeof value.head === "string"
  );
}

/** What the guest runs to hand {@link isEmptyResponseDocument} its document. */
export const READ_RESPONSE_DOCUMENT =
  "({ head: document.head?.innerHTML ?? '', body: document.body?.innerHTML ?? '' })";
