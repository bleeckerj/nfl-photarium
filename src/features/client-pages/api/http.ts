import { NextResponse } from 'next/server';

export const jsonBadRequest = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export const jsonServerError = (error: unknown, context: string) => {
  console.error(`[${context}] failed`, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Unexpected server error' },
    { status: 500 }
  );
};
