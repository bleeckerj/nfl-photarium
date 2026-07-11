import { describe, expect, it } from 'vitest';
import {
  buildVideoRotationArgs,
  buildVideoRotationFilter,
} from '@/server/videoRotationService';

describe('videoRotationService', () => {
  it('maps quarter turns to deterministic FFmpeg filters', () => {
    expect(buildVideoRotationFilter(90)).toBe('transpose=clock');
    expect(buildVideoRotationFilter(180)).toBe('hflip,vflip');
    expect(buildVideoRotationFilter(270)).toBe('transpose=cclock');
  });

  it('maps the first video and optional audio while clearing orientation metadata', () => {
    const args = buildVideoRotationArgs('/tmp/input.mp4', '/tmp/output.mp4', 90);
    expect(args).toContain('transpose=clock');
    expect(args).toContain('0:v:0');
    expect(args).toContain('0:a?');
    expect(args).toContain('rotate=0');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).toContain('+faststart');
    expect(args.at(-1)).toBe('/tmp/output.mp4');
  });
});
