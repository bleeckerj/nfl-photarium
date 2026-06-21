'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, Eye, Play, RefreshCw, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  createImageToolPreview,
  getImageToolPreview,
  getImageToolRun,
  isImageToolTransientStatusError,
  listImageTools,
  startImageToolRun,
  type ImageToolControl,
  type ImageToolDiagnosticEvent,
  type ImageToolManifest,
  type ImageToolPreview,
  type ImageToolRun,
} from '@/services/imageToolsService';
import {
  formatDiagnosticDetails,
  hasDiagnosticError,
  resolveGeneratedImageToolPreviewMedia,
} from '@/components/image-detail/image-tools/previewMedia';
import { SavedConfigurationsPanel } from '@/components/image-detail/image-tools/SavedConfigurationsPanel';
import {
  buildInitialValues,
  buildRequest,
  groupVisibleControls,
  updateToolValues,
  type ToolValues,
} from '@/components/image-detail/image-tools/controlModel';
import { ParameterGroupsLayout } from '@/components/image-detail/image-tools/ParameterGroupsLayout';

type ImageToolsPanelProps = {
  imageId: string;
  sourcePreviewUrl?: string;
  sourceLabel?: string;
  onRunComplete?: () => void | Promise<void>;
};

const RUN_POLL_MS = 1200;
const PREVIEW_POLL_MS = 900;

const isTerminalRun = (run: ImageToolRun | null) => run?.status === 'completed' || run?.status === 'failed';
const isTerminalPreview = (preview: ImageToolPreview | null) => preview?.status === 'completed' || preview?.status === 'failed';

const DiagnosticList = ({ events }: { events: ImageToolDiagnosticEvent[] }) => {
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
  const [runWarning, setRunWarning] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageToolPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
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
  const controlGroups = useMemo(
    () => selectedTool ? groupVisibleControls(selectedTool, values) : [],
    [selectedTool, values]
  );

  useEffect(() => {
    if (!run || isTerminalRun(run)) return;
    const timer = window.setInterval(() => {
      getImageToolRun(run.id)
        .then((nextRun) => {
          setRun(nextRun);
          setRunError(null);
          setRunWarning(null);
          if (nextRun.status === 'completed') {
            void onRunComplete?.();
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to refresh image tool run';
          if (isImageToolTransientStatusError(error)) {
            setRunWarning(`${message} Still checking until the render finishes.`);
            return;
          }
          setRunError(message);
          setRun((current) => current?.id === run.id
            ? { ...current, status: 'failed', message, error: message, percent: 1 }
            : current
          );
        });
    }, RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [onRunComplete, run]);

  useEffect(() => {
    if (!preview || isTerminalPreview(preview)) return;
    const timer = window.setInterval(() => {
      getImageToolPreview(preview.id)
        .then((nextPreview) => {
          setPreview(nextPreview);
          setPreviewWarning(null);
          if (nextPreview.status === 'failed') {
            setPreviewError(nextPreview.error || nextPreview.message);
          } else {
            setPreviewError(null);
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to refresh image tool preview';
          if (isImageToolTransientStatusError(error)) {
            setPreviewWarning(`${message} Still checking until the render finishes.`);
            return;
          }
          setPreviewError(message);
          setPreview((current) => current?.id === preview.id
            ? { ...current, status: 'failed', message, error: message, percent: 1 }
            : current
          );
        });
    }, PREVIEW_POLL_MS);
    return () => window.clearInterval(timer);
  }, [preview]);

  const resetToolExecutionState = () => {
    setRun(null);
    setRunError(null);
    setRunWarning(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewWarning(null);
    setPreviewing(false);
  };

  const handleSelectTool = (tool: ImageToolManifest) => {
    setSelectedToolId(tool.id);
    setValues(buildInitialValues(tool));
    resetToolExecutionState();
  };

  const handleLoadConfiguration = (nextValues: ToolValues) => {
    setValues(nextValues);
    resetToolExecutionState();
  };

  const updateControl = (control: ImageToolControl, value: string | boolean) => {
    if (!selectedTool) return;
    setValues((prev) => updateToolValues(selectedTool, prev, control, value));
  };

  const handlePreview = async () => {
    if (!selectedTool) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreviewWarning(null);
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
    setRunWarning(null);
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
  const previewRunning = Boolean(preview && !isTerminalPreview(preview));
  const busy = running || previewing || previewRunning;
  const uploadedAsset = run?.result?.uploadedAsset;
  const detailHref = uploadedAsset?.id
    ? `${uploadedAsset.assetType === 'video' ? '/videos' : '/images'}/${uploadedAsset.id}`
    : undefined;
  const previewMedia = selectedTool
    ? resolveGeneratedImageToolPreviewMedia({
        tool: selectedTool,
        preview,
      })
    : null;
  const previewStatus = preview?.message || (preview ? `Preview ${preview.status}` : null);
  const showPreviewStatus = Boolean(previewError || previewWarning || preview?.error || previewStatus || preview?.events?.length);
  const sidebarGridClass = previewMedia
    ? 'grid gap-2 sm:grid-cols-2 xl:grid-cols-1'
    : 'grid gap-2 sm:grid-cols-2';
  const effectOptionGridClass = previewMedia
    ? 'grid gap-1.5 sm:grid-cols-2 xl:grid-cols-1'
    : 'grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3';
  const effectControl = selectedTool?.controls.find((control) => control.id === 'effectId' && control.type === 'select') ?? null;
  const activeEffectValue = String(values.effectId ?? effectControl?.defaultValue ?? selectedTool?.defaultRequest.effectId ?? '');
  const consoleGroups = controlGroups
    .map((group) => ({
      ...group,
      controls: group.controls.filter((control) => control.id !== 'effectId'),
    }))
    .filter((group) => group.controls.length > 0);

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

      {tools.length > 0 && !selectedTool && (
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
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 p-3">
            <div className="font-mono">
              <p className="text-[11px] font-semibold text-gray-900">{selectedTool.label}</p>
              <p className="mt-1 max-w-3xl text-[10px] leading-snug text-gray-500">{selectedTool.description}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedToolId(null);
                resetToolExecutionState();
              }}
              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 font-mono text-[10px] text-gray-600 hover:border-gray-300"
            >
              <ChevronLeft className="h-3 w-3" />
              Catalog
            </button>
          </div>

          <div className={`grid gap-0 bg-gray-50/70 ${previewMedia ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
            {previewMedia ? (
              <div className="min-w-0 border-b border-gray-200 xl:border-b-0 xl:border-r">
                <div className="relative h-[clamp(14rem,44vh,32rem)] overflow-hidden bg-gray-50">
                  {previewMedia.kind === 'video' ? (
                    <video
                      src={previewMedia.src}
                      aria-label={previewMedia.alt}
                      className="h-full w-full object-contain"
                      autoPlay
                      controls
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <Image
                      src={previewMedia.src}
                      alt={previewMedia.alt}
                      fill
                      sizes="(max-width: 1279px) 100vw, calc(100vw - 26rem)"
                      className={previewMedia.objectFit === 'cover' ? 'object-contain opacity-80' : 'object-contain'}
                      unoptimized
                    />
                  )}
                  <span className="absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[10px] text-gray-700 shadow-sm">
                    {previewMedia.badge}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="min-w-0 space-y-4 p-3">
              <SavedConfigurationsPanel
                tool={selectedTool}
                values={values}
                busy={busy}
                onLoad={handleLoadConfiguration}
              />

              <div>
                <div className="mb-2 border-b border-gray-200 pb-1 font-mono text-[11px] font-semibold text-gray-800">Actions</div>
                <div className={sidebarGridClass}>
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {previewing || previewRunning ? 'Previewing' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1 rounded bg-gray-900 px-3 py-2 font-mono text-xs text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {running ? 'Running' : 'Run tool'}
                  </button>
                </div>
                {showPreviewStatus && (
                  <div className="mt-2 space-y-2 rounded border border-gray-200 bg-white/80 px-3 py-2">
                    {(previewError || preview?.error) && (
                      <p className="font-mono text-[11px] text-red-600">{previewError || preview?.error}</p>
                    )}
                    {previewWarning && (
                      <p className="font-mono text-[11px] text-amber-700">{previewWarning}</p>
                    )}
                    {previewStatus && <p className="font-mono text-[10px] text-gray-500">{previewStatus}</p>}
                    {preview && <DiagnosticList events={preview.events ?? []} />}
                  </div>
                )}
                {run && (
                  <div className="mt-2">
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

              <div>
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 pb-1 font-mono text-[11px] font-semibold text-gray-800">
                  <span>Effect</span>
                  <span className="text-[10px] font-normal text-gray-500">{activeEffectValue}</span>
                </div>
                {effectControl ? (
                  <div className={effectOptionGridClass}>
                    {(effectControl.options ?? []).map((option) => {
                      const optionValue = String(option.value);
                      const active = optionValue === activeEffectValue;
                      return (
                        <button
                          key={optionValue}
                          type="button"
                          onClick={() => updateControl(effectControl, optionValue)}
                          disabled={busy}
                          className={`rounded border px-2 py-2 text-left font-mono text-[10px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            active
                              ? 'border-gray-900 bg-white text-gray-950 ring-1 ring-gray-900'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {option.label}
                          {option.helpText && <span className="mt-0.5 block text-[9px] text-gray-500">{option.helpText}</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="font-mono text-[10px] text-gray-500">No effect selector available.</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 bg-gray-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 pb-1 font-mono text-[11px] font-semibold text-gray-800">
              <span>Parameters</span>
              <span className="text-[10px] font-normal text-gray-500">{consoleGroups.length} group{consoleGroups.length === 1 ? '' : 's'}</span>
            </div>
            <ParameterGroupsLayout
              groups={consoleGroups}
              values={values}
              busy={busy}
              onChange={updateControl}
            />
          </div>

          {(runError || runWarning || run?.error || run) && (
            <div className="space-y-2 border-t border-gray-200 px-3 py-2">
              {(runError || run?.error) && (
                <p className="font-mono text-[11px] text-red-600">{runError || run?.error}</p>
              )}
              {runWarning && (
                <p className="font-mono text-[11px] text-amber-700">{runWarning}</p>
              )}
              {run && <DiagnosticList events={run.events ?? []} />}
            </div>
          )}

          {run?.status === 'completed' && uploadedAsset?.id && (
            <div className="border-t border-blue-200 bg-blue-50 p-3 font-mono text-[11px] text-blue-900">
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
