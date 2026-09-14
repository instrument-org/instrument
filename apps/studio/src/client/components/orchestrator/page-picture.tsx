import { rpcClient } from "@/client/rpc/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

/**
 * A page's file as a browser draws it, photographed in a window nobody sees
 * (`files.pageThumbnail`). `version` is when the file was last written, as
 * the caller listed it: a new value is a new picture, and the last one stays
 * up until the next arrives, so a page being edited changes in place rather
 * than blinking. A caller with no listing to go by asks again each time it
 * mounts, which costs a stat when the file has not changed.
 */
export function usePagePicture({
  hostPath,
  version,
}: {
  hostPath: string;
  version?: string;
}) {
  return useQuery({
    ...rpcClient.files.pageThumbnail.queryOptions({
      input: { path: hostPath, ...(version === undefined ? {} : { version }) },
    }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: version === undefined ? 0 : Infinity,
  });
}
