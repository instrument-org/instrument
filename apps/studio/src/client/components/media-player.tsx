import { AudioSkin } from "@/client/components/videojs/audio/skin";
import { VideoSkin } from "@/client/components/videojs/video/skin";
import { readUnknownDuration } from "@/client/lib/media-duration";
import { useSiblingCaptions } from "@/client/lib/use-sibling-captions";
import { useStoryboardTrack } from "@/client/lib/use-storyboard-track";
import { Audio, AudioPlayer as AudioPlayerRoot } from "@videojs/react/audio";
import { Video, VideoPlayer as VideoPlayerRoot } from "@videojs/react/video";
import { useState } from "react";

/** Played this far, a video is being watched, and its timeline previews are made. */
const WATCHED_SECONDS = 10;

/**
 * The file viewer's video player: Video.js over the file's own `<video>`,
 * starting as it opens, muted where the viewer says so, with the captions
 * file beside the video when there is one. The player's keys answer only
 * while it has the keyboard, so the screen around it keeps its own.
 *
 * Its timeline previews are asked for once the pointer is on the player or
 * it has played a while, never as it opens, so a video glanced at costs
 * nothing and playback never waits on them.
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
  const [wantsPreviews, setWantsPreviews] = useState(false);
  const storyboard = useStoryboardTrack(hostPath, wantsPreviews);
  const onMetadata = (media: HTMLVideoElement) => {
    if (media.videoWidth === 0 && media.videoHeight === 0) {
      onAudioOnly();
      return;
    }
    readUnknownDuration(media);
  };
  return (
    <VideoPlayerRoot>
      <VideoSkin
        className="size-full"
        onPointerMove={
          wantsPreviews
            ? undefined
            : () => {
                setWantsPreviews(true);
              }
        }
      >
        <Video
          autoPlay
          muted={muted}
          onError={onError}
          onLoadedMetadata={(event) => {
            onMetadataOnce(event.currentTarget, onMetadata);
          }}
          onTimeUpdate={
            wantsPreviews
              ? undefined
              : (event) => {
                  const media = event.currentTarget;
                  if (!media.seeking && media.currentTime >= WATCHED_SECONDS) {
                    setWantsPreviews(true);
                  }
                }
          }
          playsInline
          ref={(media) => {
            whenLoadedBeforeMount(media, onMetadata);
          }}
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
          {storyboard ? (
            <track
              default
              key={storyboard}
              kind="metadata"
              label="thumbnails"
              src={storyboard}
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
            onMetadataOnce(event.currentTarget, readUnknownDuration);
          }}
          ref={(media) => {
            whenLoadedBeforeMount(media, readUnknownDuration);
          }}
          src={src}
        />
      </AudioSkin>
    </AudioPlayerRoot>
  );
}

/** The source each element's metadata was last handled for, once per source. */
const metadataRead = new WeakMap<HTMLMediaElement, string>();

function onMetadataOnce<T extends HTMLMediaElement>(
  media: T,
  onMetadata: (media: T) => void,
) {
  if (metadataRead.get(media) === media.currentSrc) {
    return;
  }
  metadataRead.set(media, media.currentSrc);
  onMetadata(media);
}

/**
 * Runs what `loadedmetadata` would have, for an element whose metadata
 * arrived before it was on the page. The element loads from the moment React
 * creates it, and a render held up (the player's own code still loading,
 * the first time a video is opened) commits it after the event has fired,
 * which React drops for an element it has not mounted yet.
 */
function whenLoadedBeforeMount<T extends HTMLMediaElement>(
  media: T | null,
  onMetadata: (media: T) => void,
) {
  if (media && media.readyState >= HTMLMediaElement.HAVE_METADATA) {
    onMetadataOnce(media, onMetadata);
  }
}
