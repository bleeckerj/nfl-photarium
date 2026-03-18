import { networkInterfaces } from 'os';
import { NextRequest, NextResponse } from 'next/server';

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const isIpv4 = (value: string) => {
  if (!IPV4_RE.test(value)) return false;
  return value.split('.').every((segment) => {
    const parsed = Number(segment);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
  });
};

const isPrivateIpv4 = (ip: string) => {
  if (!isIpv4(ip)) return false;
  const [a, b] = ip.split('.').map((segment) => Number(segment));
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const collectIpv4Candidates = () => {
  const nets = networkInterfaces();
  const privateIps: string[] = [];
  const publicIps: string[] = [];

  for (const interfaceName of Object.keys(nets)) {
    const rawEntries = nets[interfaceName] as Array<Record<string, unknown>> | undefined;
    const entries: Array<Record<string, unknown>> = Array.isArray(rawEntries) ? rawEntries : [];
    for (const entry of entries) {
      const family = typeof entry.family === 'string' ? entry.family : String(entry.family ?? '');
      const address = typeof entry.address === 'string' ? entry.address : '';
      const internal = entry.internal === true;
      if (family !== 'IPv4' || internal) continue;
      if (!isIpv4(address)) continue;
      if (isPrivateIpv4(address)) {
        privateIps.push(address);
      } else {
        publicIps.push(address);
      }
    }
  }

  return { privateIps, publicIps };
};

const toOrigin = (protocol: string, host: string, port: string) => {
  const protocolClean = protocol === 'https' ? 'https' : 'http';
  const isDefaultPort = (protocolClean === 'http' && port === '80') || (protocolClean === 'https' && port === '443');
  const portPart = port && !isDefaultPort ? `:${port}` : '';
  return `${protocolClean}://${host}${portPart}`;
};

export async function GET(request: NextRequest) {
  try {
    const protocol = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol || 'http:')
      .replace(':', '');
    const port = request.nextUrl.port || '';
    const { privateIps, publicIps } = collectIpv4Candidates();
    const preferredHost = privateIps[0] || publicIps[0] || '';
    const origin = preferredHost ? toOrigin(protocol, preferredHost, port) : '';

    return NextResponse.json({
      origin,
      privateIps,
      publicIps,
    });
  } catch (error) {
    console.error('[network-origin] Failed to resolve network origin', error);
    return NextResponse.json({ origin: '', privateIps: [], publicIps: [] });
  }
}
