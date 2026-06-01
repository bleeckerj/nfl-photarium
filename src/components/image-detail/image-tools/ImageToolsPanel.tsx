'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, Eye, Play, RefreshCw, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  createImageToolPreview,
  getImageToolRun,
  listImageTools,
  startImageToolRun,
  type ImageToolControl,
  type ImageToolDiagnosticEvent,
  type ImageToolManifest,
  type ImageToolPreview,
  type ImageToolRequest,
  type ImageToolRun,
} from '@/services/imageToolsService';

type ImageToolsPanelProps = {
  imageId: string;
  onRunComplete?: () => void | Promise<void>;
};

type ToolValues = Record<string, string | number | boolean>;

const RUN_POLL_MS = 1200;

const valueFromRequest = (request: ImageToolRequest, path: string) => {
  const parts = path.split('.');
  let current: unknown = request;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const buildInitialValues = (tool: ImageToolManifest): ToolValues => {
  const values: ToolValues = {};
  tool.controls.forEach((control) => {
    const existing = valueFromRequest(tool.defaultRequest, control.id);
    const value = existing ?? control.defaultValue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[control.id] = value;
    }
  });
  return values;
};

const assignPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.');
  let current = target;
  parts.slice(0, -1).forEach((part) => {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
  current[parts[parts.length - 1]] = value;
};

const buildRequest = (tool: ImageToolManifest, values: ToolValues): ImageToolRequest => {
  const request = JSON.parse(JSON.stringify(tool.defaultRequest)) as ImageToolRequest;
  Object.entries(values).forEach(([path, value]) => assignPath(request as unknown as Record<string, unknown>, path, value));
  return request;
};

const normalizeControlValue = (control: ImageToolControl, value: string | boolean) => {
  if (control.type === 'switch') return Boolean(value);
  if (control.type === 'number' || control.type === 'slider') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number(control.defaultValue ?? 0);
  }
  return String(value);
};

const isTerminalRun = (run: ImageToolRun | null) => run?.status === 'completed' || run?.status === 'failed';

const DiagnosticList = ({ events }: { events: ImageToolDiagnosticEvent[] }) => {
  if (!events.length) return null;
  return (
    <details className="rounded border border-gray-200 bg-gray-50/70 px-2 py-1.5 text-[10px] text-gray-600">
      <summary className="cursor-pointer font-mono text-gray-700">Diagnostics</summary>
      <div className="mt-2 max-h-44 space-y-1 overflow-auto">
        {events.slice(-12).map((event) => (
          <div key={event.id} className="grid gap-1 border-t border-gray-200 pt-1 first:border-t-0 first:pt-0 sm:grid-cols-[5.5rem_7rem_1fr]">
            <span className={event.level === 'error' ? 'text-red-600' : event.level === 'warn' ? 'text-amber-700' : 'text-gray-500'}>
              {event.level}
            </span>
            <span className="font-mono text-gray-500">{event.phase}</span>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </details>
  );
};

const PluginCard = ({
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

export function ImageToolsPanel({ imageId, onRunComplete }: ImageToolsPanelProps) {
  const [tools, setTools] = useState<ImageToolManifest[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [values, setValues] = useState<ToolValues>({});
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const [run, setRun] = useState<ImageToolRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageToolPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const loadTools = () => {
    setLoadingTools(true);
    setToolError(null);
    listImageTools()
      .then((nextTools) => {
        setTools(nextTools);
        if (selectedToolId && !nextTools.some((tool) => tool.id === selectedToolId)) {
          setSelectedToolId(null);
          setValues({});
        }
      })
      .catch((error) => setToolError(error instanceof Error ? error.message : 'Failed to load image tools'))
      .finally(() => setLoadingTools(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingTools(true);
    setToolError(null);
    listImageTools()
      .then((nextTools) => {
        if (!cancelled) setTools(nextTools);
      })
      .catch((error) => {
        if (!cancelled) setToolError(error instanceof Error ? error.message : 'Failed to load image tools');
      })
      .finally(() => {
        if (!cancelled) setLoadingTools(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedToolId) ?? null,
    [selectedToolId, tools]
  );

  useEffect(() => {
    if (!run || isTerminalRun(run)) return;
    const timer = window.setInterval(() => {
      getImageToolRun(run.id)
        .then((nextRun) => {
          setRun(nextRun);
          if (nextRun.status === 'completed') {
            void onRunComplete?.();
          }
        })
        .catch((error) => {
          setRunError(error instanceof Error ? error.message : 'Failed to refresh image tool run');
        });
    }, RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [onRunComplete, run]);

  const handleSelectTool = (tool: ImageToolManifest) => {
    setSelectedToolId(tool.id);
    setValues(buildInitialValues(tool));
    setRun(null);
    setRunError(null);
    setPreview(null);
    setPreviewError(null);
  };

  const updateControl = (control: ImageToolControl, value: string | boolean) => {
    setValues((prev) => ({
      ...prev,
      [control.id]: normalizeControlValue(control, value),
    }));
  };

  const handlePreview = async () => {
    if (!selectedTool) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const nextPreview = await createImageToolPreview({
        toolId: selectedTool.id,
        imageId,
        request: buildRequest(selectedTool, values),
      });
      setPreview(nextPreview);
      if (nextPreview.status === 'failed') {
        setPreviewError(nextPreview.error || nextPreview.message);
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to create image tool preview');
    } finally {
      setPreviewing(false);
    }
  };

  const handleRun = async () => {
    if (!selectedTool) return;
    setRunError(null);
    try {
      const nextRun = await startImageToolRun({
        toolId: selectedTool.id,
        imageId,
        request: buildRequest(selectedTool, values),
      });
      setRun(nextRun);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Failed to start image tool run');
    }
  };

  const running = Boolean(run && !isTerminalRun(run));
  const busy = running || previewing;
  const uploadedAsset = run?.result?.uploadedAsset;
  const detailHref = uploadedAsset?.id
    ? `${uploadedAsset.assetType === 'video' ? '/videos' : '/images'}/${uploadedAsset.id}`
    : undefined;

  return (
    <section id="image-tools-section" className="space-y-3 border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-3.5 w-3.5 text-gray-600" />
          <h3 className="font-mono text-xs font-semibold text-gray-800">Image Tools</h3>
          <span className="font-mono text-[10px] text-gray-400">{tools.length} plugin{tools.length === 1 ? '' : 's'}</span>
        </div>
        <button
          type="button"
          onClick={loadTools}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"
          disabled={loadingTools || busy}
          title="Refresh tools"
          aria-label="Refresh tools"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingTools ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {toolError && <p className="font-mono text-[11px] text-red-600">{toolError}</p>}

      {tools.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <PluginCard
              key={tool.id}
              tool={tool}
              selected={tool.id === selectedToolId}
              onSelect={() => handleSelectTool(tool)}
            />
          ))}
        </div>
      )}

      {selectedTool && (
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="font-mono">
              <p className="text-[11px] font-semibold text-gray-900">{selectedTool.label}</p>
              <p className="mt-1 max-w-2xl text-[10px] leading-snug text-gray-500">{selectedTool.description}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedToolId(null);
                setRun(null);
                setPreview(null);
              }}
              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 font-mono text-[10px] text-gray-600 hover:border-gray-300"
              disabled={busy}
            >
              <ChevronLeft className="h-3 w-3" />
              Catalog
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedTool.controls.map((control) => {
                const currentValue = values[control.id] ?? control.defaultValue ?? '';
                if (control.type === 'switch') {
                  return (
                    <label key={control.id} className="flex items-center justify-between gap-3 rounded border border-gray-100 px-2 py-2 font-mono text-[11px] text-gray-700">
                      <span>
                        <span className="block">{control.label}</span>
                        {control.helpText && <span className="block text-[10px] text-gray-500">{control.helpText}</span>}
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(currentValue)}
                        onChange={(event) => updateControl(control, event.target.checked)}
                        disabled={busy}
                        className="h-4 w-4"
                      />
                    </label>
                  );
                }
                if (control.type === 'select') {
                  return (
                    <label key={control.id} className="block font-mono text-[11px] text-gray-600">
                      {control.label}
                      <select
                        value={String(currentValue)}
                        onChange={(event) => updateControl(control, event.target.value)}
                        disabled={busy}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800"
                      >
                        {(control.options ?? []).map((option) => (
                          <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                        ))}
                      </select>
                      {control.helpText && <span className="mt-1 block text-[10px] font-normal text-gray-500">{control.helpText}</span>}
                    </label>
                  );
                }
                const inputType = control.type === 'color' ? 'color' : control.type === 'text' ? 'text' : 'number';
                return (
                  <label key={control.id} className="block font-mono text-[11px] text-gray-600">
                    <span className="flex items-center justify-between gap-2">
                      <span>{control.label}</span>
                      {control.type === 'slider' && <span className="text-[10px] text-gray-400">{String(currentValue)}</span>}
                    </span>
                    <input
                      type={control.type === 'slider' ? 'range' : inputType}
                      value={String(currentValue)}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      onChange={(event) => updateControl(control, event.target.value)}
                      disabled={busy}
                      className={control.type === 'slider'
                        ? 'mt-2 w-full'
                        : 'mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800'}
                    />
                    {control.helpText && <span className="mt-1 block text-[10px] font-normal text-gray-500">{control.helpText}</span>}
                  </label>
                );
              })}
            </div>

            <div className="space-y-2">
              <div className="relative aspect-square overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                {preview?.artifactUrl ? (
                  <Image
                    src={preview.artifactUrl}
                    alt={`${selectedTool.label} preview`}
                    fill
                    sizes="22rem"
                    className="object-contain"
                    unoptimized
                  />
                ) : (
                  <Image
                    src={selectedTool.presentation.previewUrl || selectedTool.presentation.thumbnailUrl}
                    alt=""
                    fill
                    sizes="22rem"
                    className="object-cover opacity-80"
                    unoptimized
                  />
                )}
              </div>
              {(previewError || preview?.error) && (
                <p className="font-mono text-[11px] text-red-600">{previewError || preview?.error}</p>
              )}
              {preview && <DiagnosticList events={preview.events ?? []} />}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePreview}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 font-mono text-xs text-gray-800 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye className="h-3.5 w-3.5" />
              {previewing ? 'Previewing' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {running ? 'Running' : 'Run tool'}
            </button>
            {run && (
              <div className="min-w-[12rem] flex-1">
                <div className="h-1.5 overflow-hidden rounded bg-gray-100">
                  <div
                    className={`h-full ${run.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'}`}
                    style={{ width: `${Math.max(4, Math.min(100, Math.round((run.percent ?? 0) * 100)))}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] text-gray-500">{run.message}</p>
              </div>
            )}
          </div>

          {(runError || run?.error) && (
            <p className="mt-2 font-mono text-[11px] text-red-600">{runError || run?.error}</p>
          )}
          {run && <div className="mt-2"><DiagnosticList events={run.events ?? []} /></div>}

          {run?.status === 'completed' && uploadedAsset?.id && (
            <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 font-mono text-[11px] text-blue-900">
              <p className="font-semibold">Generated asset created</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {detailHref && (
                  <Link href={detailHref} className="text-blue-700 underline" prefetch={false}>
                    View generated asset
                  </Link>
                )}
                <span className="text-[10px] text-blue-700">{uploadedAsset.filename || uploadedAsset.id}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
