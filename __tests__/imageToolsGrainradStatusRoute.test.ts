import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/image-tools/grainrad/status/route';

describe('GET /api/image-tools/grainrad/status', () => {
  it('reports in-process status (no external service required)', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toEqual({
      mode: 'in-process',
      managedEnabled: false,
      message: 'Grainrad runs in-process; no external service is required.',
    });
  });
});
