import { formatStatusLabel } from './formatters';
import type { ClientPageProjectStatus } from '../types';

const STATUS_STYLES: Record<ClientPageProjectStatus, string> = {
  draft: 'border-stone-300 bg-white text-stone-700',
  published: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  shadow: 'border-amber-300 bg-amber-50 text-amber-700',
  archived: 'border-slate-300 bg-slate-100 text-slate-600',
};

export function ClientPageStatusBadge({ status }: { status: ClientPageProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.2em] ${STATUS_STYLES[status]}`}
    >
      {formatStatusLabel(status)}
    </span>
  );
}
