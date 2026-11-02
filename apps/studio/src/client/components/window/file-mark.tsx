import { FileTypeIcon } from "@/client/components/extend/file-system";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

/**
 * What a file in a video's container is typed when it has no picture, by its
 * extension: a WebM (a browser's voice recording) or a 3GP (a phone's). Other
 * video names are left as video: a sound in one of those is rare, and their
 * files are too common to read each one.
 */
const SOUND_TYPES: Record<string, string> = {
  "3g2": "audio/3gpp2",
  "3gp": "audio/3gpp",
  webm: "audio/webm",
};

/** The type a file of this name has if it holds no picture, where its name cannot say. */
export function soundTypeIfNoPicture(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? SOUND_TYPES[name.slice(dot + 1).toLowerCase()] : undefined;
}

/**
 * A file's type icon, by its name, except for one that may be a video or a
 * sound (`soundTypeIfNoPicture`): it is read (`files.probeMedia`, kept per
 * version), and one with no picture wears the sound icon, as the viewer opens
 * it.
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
  const soundType = soundTypeIfNoPicture(name);
  const probe = useQuery(
    rpcClient.files.probeMedia.queryOptions({
      input: soundType === undefined ? skipToken : { path: hostPath },
      retry: false,
    }),
  );
  return (
    <FileTypeIcon
      className={className}
      {...(soundType !== undefined && probe.data?.picture === false
        ? { contentType: soundType }
        : {})}
      fileName={name}
    />
  );
}
