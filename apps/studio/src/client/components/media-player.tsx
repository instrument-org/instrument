import { AudioSkin } from "@/client/components/videojs/audio/skin";
import { VideoSkin } from "@/client/components/videojs/video/skin";
import { readUnknownDuration } from "@/client/lib/media-duration";
import { useSiblingCaptions } from "@/client/lib/use-sibling-captions";
import { Audio, AudioPlayer as AudioPlayerRoot } from "@videojs/react/audio";
import { Video, VideoPlayer as VideoPlayerRoot } from "@videojs/react/video";

/**
 * The file viewer's video player: Video.js over the file's own `<video>`,
 * starting as it opens, muted where the viewer says so, with the captions
 * file beside the video when there is one. The player's keys answer only
 * while it has the keyboard, so the screen around it keeps its own.
 *
 * Loaded on its own, the first time a video or a sound is opened.
 */
export function VideoPlayer({
  hostPath,
  muted,
  onAudioOnly,
  onError,
  src,
}: {
  hostPath: string;
  muted: boolean;
  /** A file typed as video that has no picture, such as a voice recording in WebM. */
  onAudioOnly: () => void;
  onError: () => void;
  src: string;
}) {
  const captions = useSiblingCaptions(hostPath);
  return (
    <VideoPlayerRoot>
      <VideoSkin className="size-full">
        <Video
          autoPlay
          muted={muted}
          onError={onError}
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            if (media.videoWidth === 0 && media.videoHeight === 0) {
              onAudioOnly();
              return;
            }
            readUnknownDuration(media);
          }}
          playsInline
          src={src}
        >
          {captions ? (
            <track
              default
              key={captions.url}
              kind="captions"
              label={captions.label}
              src={captions.url}
            />
          ) : null}
        </Video>
      </VideoSkin>
    </VideoPlayerRoot>
  );
}

/**
 * The file viewer's sound player: the file's name over a timeline, skip and
 * speed controls, starting as it opens where the viewer says it may play
 * sound and waiting for a press otherwise.
 */
export function AudioPlayer({
  autoPlay,
  name,
  onError,
  src,
}: {
  autoPlay: boolean;
  name: string;
  onError: () => void;
  src: string;
}) {
  return (
    <AudioPlayerRoot>
      <AudioSkin name={name}>
        <Audio
          autoPlay={autoPlay}
          onError={onError}
          onLoadedMetadata={(event) => {
            readUnknownDuration(event.currentTarget);
          }}
          src={src}
        />
      </AudioSkin>
    </AudioPlayerRoot>
  );
}
