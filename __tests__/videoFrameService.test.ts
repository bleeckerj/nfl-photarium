import { describe, expect, it } from 'vitest';
import {
  buildPreviewFrames,
  parseFrameSelector,
  resolveFrameSelector,
} from '@/server/videoFrameService';

describe('videoFrameService', () => {
  it('parses symbolic frame selectors', () => {
    expect(parseFrameSelector('first,last')).toEqual({
      symbolic: ['first', 'last'],
      numeric: [],
      invalid: [],
    });
  });

  it('parses symbolic and numeric selectors together', () => {
    expect(parseFrameSelector('first, 100, last')).toEqual({
      symbolic: ['first', 'last'],
      numeric: [100],
      invalid: [],
    });
  });

  it('resolves first middle and last', () => {
    expect(resolveFrameSelector({ selector: 'first,middle,last', frameCount: 101 })).toEqual({
      frames: [1, 51, 101],
      invalid: [],
    });
  });

  it('resolves numeric selectors and dedupes overlaps', () => {
    expect(resolveFrameSelector({ selector: '1,100,first', frameCount: 100 })).toEqual({
      frames: [1, 100],
      invalid: [],
    });
  });

  it('reports invalid selector tokens and out of range frames', () => {
    expect(resolveFrameSelector({ selector: '0,-1,wat,101', frameCount: 100 })).toEqual({
      frames: [],
      invalid: ['-1', '0', '101', 'wat'],
    });
  });

  it('builds evenly distributed preview frames', () => {
    expect(buildPreviewFrames({ frameCount: 100, fps: 25, count: 5 })).toEqual([
      { frameNumber: 1, timeSeconds: 0 },
      { frameNumber: 26, timeSeconds: 1 },
      { frameNumber: 51, timeSeconds: 2 },
      { frameNumber: 75, timeSeconds: 2.96 },
      { frameNumber: 100, timeSeconds: 3.96 },
    ]);
  });
});
