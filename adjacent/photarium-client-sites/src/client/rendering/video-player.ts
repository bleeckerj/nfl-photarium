import Hls from 'hls.js';
import type { ResolvedVideoPlayback } from './media';

export const attachResolvedVideoPlayback = async (
  video: HTMLVideoElement,
  playback: ResolvedVideoPlayback,
  options: {
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
  } = {}
): Promise<() => void> => {
  const { autoplay = false, loop = true, muted = false } = options;

  video.playsInline = true;
  video.preload = 'metadata';
  video.loop = loop;
  video.muted = muted;

  if (!playback.playUrl || !playback.playbackKind) {
    return () => undefined;
  }

  let hls: Hls | null = null;

  if (playback.playbackKind === 'hls') {
    const canPlayHlsNatively = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (canPlayHlsNatively) {
      video.src = playback.playUrl;
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
      });
      hls.loadSource(playback.playUrl);
      hls.attachMedia(video);
    } else {
      return () => undefined;
    }
  } else {
    video.src = playback.playUrl;
  }

  if (autoplay) {
    void video.play().catch(() => undefined);
  }

  return () => {
    hls?.destroy();
    hls = null;
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // Ignore cleanup errors on detached media nodes.
    }
  };
};
