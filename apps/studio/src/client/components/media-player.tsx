import { AudioSkin } from "@/client/components/videojs/audio/skin";
import { VideoSkin } from "@/client/components/videojs/video/skin";
import { readUnknownDuration } from "@/client/lib/media-duration";
import { useSiblingCaptions } from "@/client/lib/use-sibling-captions";
import { useStoryboardTrack } from "@/client/lib/use-storyboard-track";
import { Audio, AudioPlayer as AudioPlayerRoot } from "@videojs/react/audio";
import { Video, VideoPlayer as VideoPlayerRoot } from "@videojs/react/video";
import { useEffect, useRef, useState } from "react";

/** Played this far, a video is being watched, and its timeline previews are made. */
const WATCHED_SECONDS = 10;

/**
 * The file viewer's video player: Video.js over the file's own `<video>`,
 * starting as it opens where the viewer says it may, with the captions
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
  autoPlay,
  hostPath,
  onError,
  src,
}: {
  autoPlay: boolean;
  hostPath: string;
  onError: () => void;
  src: string;
}) {
  const captions = useSiblingCaptions(hostPath);
  const [wantsPreviews, setWantsPreviews] = useState(false);
  const storyboard = useStoryboardTrack(hostPath, wantsPreviews);
  const mediaRef = usePlayerSession<HTMLVideoElement>(autoPlay);
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
          mediaRef={mediaRef}
          onError={onError}
          onLoadedMetadata={(event) => {
            onMetadataOnce(event.currentTarget, readUnknownDuration);
          }}
          onPlay={pauseOtherPlayers}
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
            whenLoadedBeforeMount(media, readUnknownDuration);
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
  const mediaRef = usePlayerSession<HTMLAudioElement>(autoPlay);
  return (
    <AudioPlayerRoot>
      <AudioSkin name={name}>
        <Audio
          mediaRef={mediaRef}
          onError={onError}
          onLoadedMetadata={(event) => {
            onMetadataOnce(event.currentTarget, readUnknownDuration);
          }}
          onPlay={pauseOtherPlayers}
          ref={(media) => {
            whenLoadedBeforeMount(media, readUnknownDuration);
          }}
          src={src}
        />
      </AudioSkin>
    </AudioPlayerRoot>
  );
}

/** Every player on a page of the window, playing or not. */
const players = new Set<HTMLMediaElement>();

/**
 * A player's hold on its element, for as long as it is mounted, and the one
 * place it starts playing. The element is rendered without `autoplay`: React
 * builds elements while it renders and throws some renders away, and an
 * `autoplay` element it built and never mounted plays on its own, with sound,
 * where nothing can reach it. Started here instead, from the effect, it plays
 * only once it is on the page.
 *
 * Taken off the page, the element is paused and emptied of its source, so
 * nothing that still holds it can make it sound again. One kept on the page
 * out of sight (a tab behind) stays as it is, and so does one React mounts
 * twice in development, which is still on the page when the first mount is
 * cleaned up.
 */
function usePlayerSession<T extends HTMLMediaElement>(autoPlay: boolean) {
  const mediaRef = useRef<T | null>(null);
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    players.add(media);
    // Started on mount and again whenever it can play until it does: a load
    // that lands after mount (its address updated to the file's version)
    // interrupts the first play().
    const start = () => {
      if (media.isConnected && media.paused) {
        media.play().catch(() => undefined);
      }
    };
    const started = () => {
      media.removeEventListener("canplay", start);
      media.removeEventListener("playing", started);
    };
    if (autoPlay) {
      media.addEventListener("canplay", start);
      media.addEventListener("playing", started);
      start();
    }
    return () => {
      started();
      players.delete(media);
      if (media.isConnected) {
        return;
      }
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
    // Decided once, as the player opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mediaRef;
}

/** One player sounds at a time: the one that starts pauses the rest. */
function pauseOtherPlayers(event: { currentTarget: HTMLMediaElement }) {
  for (const other of players) {
    if (other !== event.currentTarget && !other.paused) {
      other.pause();
    }
  }
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
