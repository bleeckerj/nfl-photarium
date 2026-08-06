import Image from 'next/image';
import type { ImageToolDiagnosticEvent, ImageToolManifest } from '@/services/imageToolsService';
import { formatDiagnosticDetails, hasDiagnosticError } from '@/components/image-detail/image-tools/previewMedia';


export const DiagnosticList = ({ events }: { events: ImageToolDiagnosticEvent[] }) => {
  if (!events.length) return null;
  const open = hasDiagnosticError(events);
  return (
    <details open={open} className="rounded border border-gray-200 bg-gray-50/70 px-2 py-1.5 text-[10px] text-gray-600">
      <summary className="cursor-pointer font-mono text-gray-700">Diagnostics</summary>
      <div className="mt-2 max-h-44 space-y-1 overflow-auto">
        {events.slice(-12).map((event) => {
          const details = formatDiagnosticDetails(event.details);
          return (
            <div key={event.id} className="grid gap-1 border-t border-gray-200 pt-1 first:border-t-0 first:pt-0 sm:grid-cols-[5.5rem_7rem_1fr]">
              <span className={event.level === 'error' ? 'text-red-600' : event.level === 'warn' ? 'text-amber-700' : 'text-gray-500'}>
                {event.level}
              </span>
              <span className="font-mono text-gray-500">{event.phase}</span>
              <span>
                <span>{event.message}</span>
                {details && <span className="mt-0.5 block font-mono text-[9px] text-gray-400">{details}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
};

export const PluginCard = ({
  selected,
  tool,
  onSelect,
}: {
  selected: boolean;
  tool: ImageToolManifest;
  onSelect: () => void;
}) => {
  const mediaUrl = tool.presentation.previewUrl || tool.presentation.thumbnailUrl;
  const isVideo = tool.presentation.previewMimeType?.startsWith('video/');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group overflow-hidden rounded-md border bg-white text-left transition hover:border-gray-400 hover:shadow-sm ${
        selected ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'
      }`}
    >
      <div className="relative aspect-[5/3] overflow-hidden border-b border-gray-100 bg-gray-100">
        {isVideo ? (
          <video src={mediaUrl} muted loop playsInline autoPlay className="h-full w-full object-cover" />
        ) : (
          <Image src={mediaUrl} alt="" fill sizes="(max-width: 1024px) 50vw, 33vw" className="object-cover" unoptimized />
        )}
      </div>
      <div className="space-y-1 p-2 font-mono">
        <div className="text-[11px] font-semibold text-gray-900">{tool.label}</div>
        <p className="line-clamp-2 text-[10px] leading-snug text-gray-500">
          {tool.presentation.shortDescription || tool.description}
        </p>
      </div>
    </button>
  );
};
