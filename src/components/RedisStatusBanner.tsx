'use client';

import { useEffect, useMemo, useState } from 'react';
import { Database, Info } from 'lucide-react';
import { RedisInfoModal } from '@/components/RedisInfoModal';

type VectorStatusResponse =
  | { available: true }
  | { available: false; error?: string; help?: string };

export function RedisStatusBanner() {
  const envDisabled = process.env.NEXT_PUBLIC_REDIS_STATUS_POLL_DISABLED;
  const defaultDisabled = process.env.NODE_ENV === 'development';
  const isDisabled =
    envDisabled === 'true' ||
    envDisabled === '1' ||
    (envDisabled === undefined && defaultDisabled);
  const pollMs = Number(process.env.NEXT_PUBLIC_REDIS_STATUS_POLL_MS ?? 30_000);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [help, setHelp] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isDisabled) return;
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch('/api/images/vectors/status', { cache: 'no-store' });
        const data = (await res.json()) as VectorStatusResponse;
        if (cancelled) return;
        setAvailable(Boolean((data as { available?: boolean }).available));
        if ((data as { available?: boolean }).available === false) {
          setHelp((data as { help?: string }).help ?? 'Run: npm run redis:start');
        }
      } catch {
        if (!cancelled) {
          setAvailable(false);
          setHelp('Run: npm run redis:start');
        }
      }
    };

    run();
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      return () => {
        cancelled = true;
      };
    }
    const interval = window.setInterval(run, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isDisabled, pollMs]);

  const show = useMemo(() => available === false, [available]);
  if (!show) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 border border-orange-200 bg-orange-50 text-orange-800 rounded-md hover:bg-orange-100 transition-colors"
        title={help ?? undefined}
      >
        <Database className="h-4 w-4" />
        <span className="text-xs font-mono">Redis offline (AI features disabled)</span>
        <Info className="h-4 w-4 opacity-70" />
      </button>
      <RedisInfoModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
