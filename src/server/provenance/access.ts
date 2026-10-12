import { timingSafeEqual } from 'node:crypto';
import { ProvenanceError } from './validation';

export function requireProvenanceAccess(request: Request): void {
  const token = process.env.PHOTARIUM_PROVENANCE_TOKEN?.trim();
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const expectedBytes = Buffer.from(token ?? '');
  const providedBytes = Buffer.from(provided);
  if (token && expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)) return;
  const url = new URL(request.url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const origin = request.headers.get('origin');
  const forwarded = request.headers.get('x-forwarded-for');
  const localForwarding = !forwarded || forwarded.split(',').every((host) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(host.trim()));
  // Receipts can contain private filesystem paths. The default local operator service is
  // permitted; nonlocal or proxied access requires a server-only bearer credential.
  if (!loopback || !localForwarding || (origin && origin !== url.origin)) {
    throw new ProvenanceError('Operator access is required for provenance receipts', 403);
  }
}
