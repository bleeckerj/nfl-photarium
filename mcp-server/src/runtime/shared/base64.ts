export function parseDataUrl(value: string): { mimeType?: string; data: string } {
  if (!value.startsWith('data:')) {
    return { data: value };
  }
  const [header, data] = value.split(',', 2);
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  return { mimeType: mimeMatch?.[1], data: data || '' };
}

export function decodeBase64(value: string): { buffer: Buffer; mimeType?: string } {
  const { mimeType, data } = parseDataUrl(value);
  const buffer = Buffer.from(data, 'base64');
  return { buffer, mimeType };
}
