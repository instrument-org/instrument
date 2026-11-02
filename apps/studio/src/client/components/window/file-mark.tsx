import { FileTypeIcon } from "@/client/components/extend/file-system";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

/**
 * A file's type icon, by its name, except for a WebM, which may be a video or
 * a sound: it is read (`files.probeMedia`, kept per version), and one with no
 * picture (a voice recording) wears the sound icon, as the viewer opens it.
 */
export function FileMark({
  className,
  hostPath,
  name,
}: {
  className?: string;
  hostPath: string;
  name: string;
}) {
  const probe = useQuery(
    rpcClient.files.probeMedia.queryOptions({
      input: /\.webm$/i.test(name) ? { path: hostPath } : skipToken,
      retry: false,
    }),
  );
  return (
    <FileTypeIcon
      className={className}
      {...(probe.data?.picture === false ? { contentType: "audio/webm" } : {})}
      fileName={name}
    />
  );
}
