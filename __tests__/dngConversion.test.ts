import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { convertDngToPng } from '@/server/dngConversion';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

const originalPlatform = process.platform;
type Callback = (error: Error | null, stdout?: string, stderr?: string) => void;

describe('DNG decoding', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { Object.defineProperty(process, 'platform', { value: originalPlatform }); });

  it.each(['darwin', 'linux'])('decodes using the native %s tool and removes temporary files', async (platform) => {
    Object.defineProperty(process, 'platform', { value: platform });
    const source = Buffer.from('camera-raw-source');
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).png().toBuffer();
    let temporaryDirectory = '';
    execFileMock.mockImplementation((command: string, args: string[], options: { timeout: number }, callback: Callback) => {
      const output = platform === 'darwin' ? args[5] : args[3];
      const input = platform === 'darwin' ? args[3] : args[4];
      temporaryDirectory = dirname(input);
      expect(command).toBe(platform === 'darwin' ? '/usr/bin/sips' : 'dcraw_emu');
      expect(options.timeout).toBe(120_000);
      void readFile(input).then(async (bytes) => {
        expect(bytes).toEqual(source);
        await writeFile(output, png);
        callback(null, '', '');
      }).catch(callback);
    });
    const result = await convertDngToPng(source);
    expect(await sharp(result).metadata()).toMatchObject({ format: 'png', width: 40, height: 30 });
    await expect(readdir(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a missing decoder and cleans up after failure', async () => {
    let temporaryDirectory = '';
    execFileMock.mockImplementation((_command: string, args: string[], _options: unknown, callback: Callback) => {
      temporaryDirectory = dirname(args[originalPlatform === 'darwin' ? 3 : 4]);
      callback(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    });
    await expect(convertDngToPng(Buffer.from('raw'))).rejects.toThrow('requires macOS sips or LibRaw dcraw_emu');
    await expect(readdir(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects corrupt or timed-out input instead of forwarding raw bytes', async () => {
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, callback: Callback) => callback(new Error('decode failed')));
    await expect(convertDngToPng(Buffer.from('invalid'))).rejects.toThrow('DNG conversion failed');
    await expect(convertDngToPng(Buffer.alloc(0))).rejects.toThrow('must contain image data');
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
