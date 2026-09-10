import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const MAX_DNG_BYTES = 500 * 1024 * 1024;
const MAX_DECODED_BYTES = 600 * 1024 * 1024;
const MAX_DECODED_PIXELS = 150_000_000;
let conversionQueue: Promise<unknown> = Promise.resolve();

async function decodeDng(buffer: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'photarium-dng-'));
  try {
    const source = join(directory, 'source.dng');
    const output = join(directory, process.platform === 'darwin' ? 'decoded.png' : 'decoded.tiff');
    await writeFile(source, buffer);
    const options = { timeout: 120_000, maxBuffer: 1024 * 1024 };
    // Decode the raw image with a camera-aware decoder. Sharp may otherwise
    // read only a DNG's TIFF preview, silently discarding the full-resolution image.
    if (process.platform === 'darwin') {
      await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', output], options);
    } else {
      await execFileAsync('dcraw_emu', ['-w', '-T', '-Z', output, source], options);
    }
    if ((await stat(output)).size > MAX_DECODED_BYTES) {
      throw new Error('Decoded DNG exceeds the 600 MB conversion limit.');
    }
    // Apply orientation and normalize the decoded color space without cropping.
    return await sharp(await readFile(output), { limitInputPixels: MAX_DECODED_PIXELS })
      .rotate()
      .toColourspace('srgb')
      .png()
      .toBuffer();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function convertDngToPng(buffer: Buffer): Promise<Buffer> {
  if (!buffer.length || buffer.byteLength > MAX_DNG_BYTES) {
    throw new Error('DNG must contain image data and be no larger than 500 MB.');
  }
  // Raw decoding can allocate hundreds of MB; process one per server instance.
  const pending = conversionQueue.then(() => decodeDng(buffer));
  conversionQueue = pending.catch(() => {});
  try {
    return await pending;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') {
      throw new Error('DNG conversion requires macOS sips or LibRaw dcraw_emu installed on the Photarium server.');
    }
    throw new Error('DNG conversion failed. The file may be corrupt, unsupported by the server decoder, or exceed conversion limits.');
  }
}
