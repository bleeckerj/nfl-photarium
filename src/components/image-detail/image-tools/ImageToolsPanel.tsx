'use client';

import { RefreshCw, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  createImageToolPreview,
  acceptImageToolPreview,
  getImageToolPreview,
  getImageToolRun,
  isImageToolTransientStatusError,
  listImageTools,
  savePromptThis,
  startImageToolRun,
  type ImageToolUploadedAsset,
  type ImageToolControl,
  type ImageToolManifest,
  type ImageToolPreview,
  type ImageToolRun,
} from '@/services/imageToolsService';
import { resolveGeneratedImageToolPreviewMedia } from '@/components/image-detail/image-tools/previewMedia';
import { PluginCard } from '@/components/image-detail/image-tools/ToolCards';
import { ToolExecutionPanel } from '@/components/image-detail/image-tools/ToolExecutionPanel';
import {
  buildInitialValues,
  buildRequest,
  groupVisibleControls,
  updateToolValues,
  type ToolValues,
} from '@/components/image-detail/image-tools/controlModel';

type ImageToolsPanelProps = {
  imageId: string;
  sourcePreviewUrl?: string;
  sourceLabel?: string;
  onRunComplete?: () => void | Promise<void>;
};

const RUN_POLL_MS = 1200;
const PREVIEW_POLL_MS = 900;

const isTerminalRun = (value: ImageToolRun) => value.status === 'completed' || value.status === 'failed';
const isTerminalPreview = (value: ImageToolPreview) => value.status === 'completed' || value.status === 'failed';


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
  const [acceptingPreview, setAcceptingPreview] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptedAsset, setAcceptedAsset] = useState<ImageToolUploadedAsset | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [promptSaveStatus, setPromptSaveStatus] = useState<string | null>(null);
  const [promptSaveError, setPromptSaveError] = useState<string | null>(null);

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

  const promptResult = preview?.kind === 'prompt' && preview.prompt
    ? preview.prompt
    : run?.result?.kind === 'prompt' && run.result.prompt
      ? run.result.prompt
      : null;

  useEffect(() => {
    if (promptResult) setEditedPrompt(promptResult);
  }, [promptResult]);

  const resetToolExecutionState = () => {
    setRun(null);
    setRunError(null);
    setRunWarning(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewWarning(null);
    setPreviewing(false);
    setAcceptingPreview(false);
    setAcceptError(null);
    setAcceptedAsset(null);
    setEditedPrompt('');
    setPromptSaveStatus(null);
    setPromptSaveError(null);
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
    setAcceptError(null);
    setAcceptedAsset(null);
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
    setAcceptError(null);
    setAcceptedAsset(null);
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

  const handleAcceptPreview = async () => {
    if (!preview || preview.status !== 'completed') return;
    setAcceptingPreview(true);
    setAcceptError(null);
    try {
      const result = await acceptImageToolPreview(preview.id);
      setAcceptedAsset(result.uploadedAsset);
      setPreview(result.preview);
      await onRunComplete?.();
    } catch (error) {
      setAcceptError(error instanceof Error ? error.message : 'Failed to accept image tool preview');
    } finally {
      setAcceptingPreview(false);
    }
  };

  const handleSavePrompt = async () => {
    const prompt = editedPrompt.trim();
    if (!prompt) return;
    setPromptSaveStatus(null);
    setPromptSaveError(null);
    try {
      await savePromptThis(imageId, prompt);
      setPromptSaveStatus('Saved as current Prompt This');
    } catch (error) {
      setPromptSaveError(error instanceof Error ? error.message : 'Failed to save Prompt This');
    }
  };

  const running = Boolean(run && !isTerminalRun(run));
  const previewRunning = Boolean(preview && !isTerminalPreview(preview));
  const busy = running || previewing || previewRunning || acceptingPreview;
  const uploadedAsset = run?.result?.uploadedAsset ?? acceptedAsset;
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
  const showPreviewStatus = Boolean(previewError || previewWarning || acceptError || preview?.error || previewStatus || preview?.events?.length);
  const canAcceptPreview = Boolean(preview?.status === 'completed' && preview.artifactUrl && !acceptedAsset);
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
        <ToolExecutionPanel
          selectedTool={selectedTool}
          values={values}
          busy={busy}
          previewMedia={previewMedia}
          sidebarGridClass={sidebarGridClass}
          effectOptionGridClass={effectOptionGridClass}
          effectControl={effectControl}
          activeEffectValue={activeEffectValue}
          consoleGroups={consoleGroups}
          previewing={previewing}
          previewRunning={previewRunning}
          running={running}
          acceptingPreview={acceptingPreview}
          canAcceptPreview={canAcceptPreview}
          showPreviewStatus={showPreviewStatus}
          preview={preview}
          previewError={previewError}
          previewWarning={previewWarning}
          acceptError={acceptError}
          previewStatus={previewStatus}
          run={run}
          runError={runError}
          runWarning={runWarning}
          editedPrompt={editedPrompt}
          setEditedPrompt={setEditedPrompt}
          promptSaveStatus={promptSaveStatus}
          promptSaveError={promptSaveError}
          uploadedAsset={uploadedAsset}
          detailHref={detailHref}
          onBackToCatalog={() => {
            setSelectedToolId(null);
            resetToolExecutionState();
          }}
          onLoadConfiguration={handleLoadConfiguration}
          onPreview={handlePreview}
          onRun={handleRun}
          onAcceptPreview={handleAcceptPreview}
          onSavePrompt={handleSavePrompt}
          onUpdateControl={updateControl}
        />
      )}

    </section>
  );
}
