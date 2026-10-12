import { readProvenance, writeProvenance } from '@/server/provenance/routes';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return readProvenance(request, (await params).id);
}
export async function POST(request: Request, { params }: Context) {
  return writeProvenance(request, (await params).id);
}
