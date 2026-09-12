import { createHash } from 'node:crypto';
import { downloadSourceImage } from './sourceDownloader';

/** Compare the original uploaded bytes against the file inspected by the worker. */
export async function verifyDemarkHostedOriginal(childId: string, expected: Buffer): Promise<string> {
  const hosted = await downloadSourceImage(childId, { requireOriginal: true });
  const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const sha256 = digest(hosted.buffer);
  if (sha256 !== digest(expected)) {
    throw new Error(`Hosted original verification failed for child ${childId}: uploaded bytes changed`);
  }
  return sha256;
}
