import { describe, expect, it, vi } from 'vitest';
import { attachResolvedVideoPlayback } from '../src/client/rendering/video-player';
import type { ResolvedVideoPlayback } from '../src/client/rendering/media';

const createPlayback = (): ResolvedVideoPlayback => ({
  playUrl: 'https://cdn.example.com/video.mp4',
  playbackKind: 'file',
  posterUrl: 'https://cdn.example.com/poster.jpg',
  downloadUrl: null,
  durationSeconds: 3,
  hasPlayableSource: true,
  hasDownloadableSource: false,
});

const createVideo = () => {
  const play = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn();
  const removeAttribute = vi.fn();
  const load = vi.fn();

  return {
    play,
    pause,
    removeAttribute,
    load,
    canPlayType: vi.fn().mockReturnValue(''),
    playsInline: false,
    preload: '',
    loop: false,
    muted: false,
    src: '',
  };
};

describe('attachResolvedVideoPlayback', () => {
  it('loops by default and preserves autoplay/muted behavior', async () => {
    const video = createVideo();

    const cleanup = await attachResolvedVideoPlayback(
      video as unknown as HTMLVideoElement,
      createPlayback(),
      {
        autoplay: true,
        muted: true,
      }
    );

    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe('metadata');
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.src).toBe('https://cdn.example.com/video.mp4');
    expect(video.play).toHaveBeenCalledTimes(1);

    cleanup();

    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it('allows callers to disable looping explicitly', async () => {
    const video = createVideo();

    await attachResolvedVideoPlayback(
      video as unknown as HTMLVideoElement,
      createPlayback(),
      {
        loop: false,
      }
    );

    expect(video.loop).toBe(false);
    expect(video.play).not.toHaveBeenCalled();
  });
});
