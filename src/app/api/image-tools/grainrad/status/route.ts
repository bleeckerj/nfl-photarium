import { NextResponse } from 'next/server';

// Grainrad now runs in-process as a library (no separate service to start or
// health-check). This endpoint is retained for backward compatibility and
// always reports ready.
export const GET = async () =>
  NextResponse.json({
    status: {
      mode: 'in-process',
      managedEnabled: false,
      message: 'Grainrad runs in-process; no external service is required.',
    },
  });
