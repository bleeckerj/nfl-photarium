'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, Eye, Play } from 'lucide-react';
import type React from 'react';
import type {
  ImageToolControl,
  ImageToolManifest,
  ImageToolPreview,
  ImageToolRun,
  ImageToolUploadedAsset,
} from '@/services/imageToolsService';
import type { ToolValues } from '@/components/image-detail/image-tools/controlModel';
import { groupVisibleControls } from '@/components/image-detail/image-tools/controlModel';
import type { ImageToolPreviewMedia } from '@/components/image-detail/image-tools/previewMedia';
import { DiagnosticList } from '@/components/image-detail/image-tools/ToolCards';
import { SavedConfigurationsPanel } from '@/components/image-detail/image-tools/SavedConfigurationsPanel';
import { ParameterGroupsLayout } from '@/components/image-detail/image-tools/ParameterGroupsLayout';

type ToolExecutionPanelProps = {
  selectedTool: ImageToolManifest | null;
  values: ToolValues;
  busy: boolean;
  previewMedia: ImageToolPreviewMedia | null;
  sidebarGridClass: string;
  effectOptionGridClass: string;
  effectControl: ImageToolControl | null;
  activeEffectValue: string;
  consoleGroups: ReturnType<typeof groupVisibleControls>;
  previewing: boolean;
  previewRunning: boolean;
  running: boolean;
  acceptingPreview: boolean;
  canAcceptPreview: boolean;
  showPreviewStatus: boolean;
  preview: ImageToolPreview | null;
  previewError: string | null;
  previewWarning: string | null;
  acceptError: string | null;
  previewStatus: string | null;
  run: ImageToolRun | null;
  runError: string | null;
  runWarning: string | null;
  editedPrompt: string;
  setEditedPrompt: React.Dispatch<React.SetStateAction<string>>;
  promptSaveStatus: string | null;
  promptSaveError: string | null;
  uploadedAsset: ImageToolUploadedAsset | null;
  detailHref?: string;
  onBackToCatalog: () => void;
  onLoadConfiguration: (values: ToolValues) => void;
  onPreview: () => void;
  onRun: () => void;
  onAcceptPreview: () => void;
  onSavePrompt: () => void;
  onUpdateControl: (control: ImageToolControl, value: string | boolean) => void;
};

export function ToolExecutionPanel({
  selectedTool, values, busy, previewMedia, sidebarGridClass, effectOptionGridClass, effectControl,
  activeEffectValue, consoleGroups, previewing, previewRunning, running, acceptingPreview, canAcceptPreview,
  showPreviewStatus, preview, previewError, previewWarning, acceptError, previewStatus, run, runError, runWarning,
  editedPrompt, setEditedPrompt, promptSaveStatus, promptSaveError, uploadedAsset, detailHref, onBackToCatalog,
  onLoadConfiguration, onPreview, onRun, onAcceptPreview, onSavePrompt, onUpdateControl,
}: ToolExecutionPanelProps) {
  return (
    <>
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
                onBackToCatalog();
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
                onLoad={onLoadConfiguration}
              />

              <div>
                <div className="mb-2 border-b border-gray-200 pb-1 font-mono text-[11px] font-semibold text-gray-800">Actions</div>
                <div className={sidebarGridClass}>
                  <button
                    type="button"
                    onClick={onPreview}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {previewing || previewRunning ? 'Previewing' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    onClick={onRun}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1 rounded bg-gray-900 px-3 py-2 font-mono text-xs text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {running ? 'Running' : 'Run tool'}
                  </button>
                  {canAcceptPreview && (
                    <button
                      type="button"
                      onClick={onAcceptPreview}
                      disabled={busy}
                      className="inline-flex items-center justify-center gap-1 rounded border border-blue-300 bg-blue-50 px-3 py-2 font-mono text-xs text-blue-900 hover:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {acceptingPreview ? 'Accepting' : 'Accept preview'}
                    </button>
                  )}
                </div>
                {showPreviewStatus && (
                  <div className="mt-2 space-y-2 rounded border border-gray-200 bg-white/80 px-3 py-2">
                    {(previewError || preview?.error) && (
                      <p className="font-mono text-[11px] text-red-600">{previewError || preview?.error}</p>
                    )}
                    {previewWarning && (
                      <p className="font-mono text-[11px] text-amber-700">{previewWarning}</p>
                    )}
                    {acceptError && (
                      <p className="font-mono text-[11px] text-red-600">{acceptError}</p>
                    )}
                    {previewStatus && <p className="font-mono text-[10px] text-gray-500">{previewStatus}</p>}
                    {preview?.kind === 'prompt' && preview.prompt && (
                      <textarea
                        value={editedPrompt}
                        onChange={(event) => setEditedPrompt(event.target.value)}
                        rows={8}
                        aria-label="Derived prompt preview"
                        className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-gray-700"
                      />
                    )}
                    {preview?.kind === 'prompt' && preview.prompt && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={onSavePrompt}
                          disabled={busy || !editedPrompt.trim()}
                          className="rounded border border-gray-300 bg-white px-2 py-1 font-mono text-[10px] text-gray-700 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save as current Prompt This
                        </button>
                        {promptSaveStatus && <span className="font-mono text-[10px] text-green-700">{promptSaveStatus}</span>}
                        {promptSaveError && <span className="font-mono text-[10px] text-red-600">{promptSaveError}</span>}
                      </div>
                    )}
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
                    {run.result?.kind === 'prompt' && run.result.prompt && (
                      <div className="mt-2 rounded border border-gray-200 bg-white p-2">
                        <p className="mb-1 font-mono text-[10px] font-semibold text-gray-700">Derived prompt</p>
                        <textarea
                          value={editedPrompt}
                          onChange={(event) => setEditedPrompt(event.target.value)}
                          rows={8}
                          className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-gray-700"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                          onClick={onSavePrompt}
                            disabled={busy || !editedPrompt.trim()}
                            className="rounded border border-gray-300 bg-white px-2 py-1 font-mono text-[10px] text-gray-700 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Save as current Prompt This
                          </button>
                          {promptSaveStatus && <span className="font-mono text-[10px] text-green-700">{promptSaveStatus}</span>}
                          {promptSaveError && <span className="font-mono text-[10px] text-red-600">{promptSaveError}</span>}
                        </div>
                      </div>
                    )}
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
                          onClick={() => onUpdateControl(effectControl, optionValue)}
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
              onChange={onUpdateControl}
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

          {uploadedAsset?.id && (
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
    </>
  );
}
