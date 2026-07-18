'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/Toast';
import type { CloudflareImage } from '@/components/gallery/types';
import { dedupeImageIds } from '../utils/imageIds';
import type { ClientPageAssetIssue, ClientPageProjectRecord } from '../types';
import { clientPageApi, type ClientSiteSummary } from './api';
import { ClientPageMetadataForm } from './ClientPageMetadataForm';
import { ClientPagePublishPanel } from './ClientPagePublishPanel';
import { ClientPageSelectionPanel } from './ClientPageSelectionPanel';
import { ClientPageAssetPicker } from './ClientPageAssetPicker';
import { ClientPageStatusBadge } from './statusBadge';

interface ClientPageEditorProps {
  initialProject: ClientPageProjectRecord;
  initialShareUrl: string | null;
}

const removeImageId = (selectedImageIds: string[], imageId: string) =>
  selectedImageIds.filter((entry) => entry !== imageId);

const moveImageId = (selectedImageIds: string[], imageId: string, direction: -1 | 1) => {
  const currentIndex = selectedImageIds.indexOf(imageId);
  if (currentIndex === -1) return selectedImageIds;
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= selectedImageIds.length) return selectedImageIds;
  const next = [...selectedImageIds];
  const [item] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
};

const buildSelectedImages = (selectedImageIds: string[], images: CloudflareImage[]) => {
  const imageMap = new Map(images.map((image) => [image.id, image]));
  return selectedImageIds.map(
    (imageId) =>
      imageMap.get(imageId) ?? {
        id: imageId,
        filename: imageId,
        uploaded: '',
        variants: [],
      }
  );
};

export function ClientPageEditor({ initialProject, initialShareUrl }: ClientPageEditorProps) {
  const [project, setProject] = useState(initialProject);
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl);
  const [catalogImages, setCatalogImages] = useState<CloudflareImage[]>([]);
  const [clientSites, setClientSites] = useState<ClientSiteSummary[]>([]);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [repairIssues, setRepairIssues] = useState<ClientPageAssetIssue[]>([]);
  const [repairBusy, setRepairBusy] = useState(false);
  const toast = useToast();

  const selectedImages = useMemo(
    () => buildSelectedImages(project.selectedImageIds, catalogImages),
    [catalogImages, project.selectedImageIds]
  );

  useEffect(() => {
    clientPageApi
      .listClientSites()
      .then(setClientSites)
      .catch(() => {
        // Non-fatal; project metadata can still be edited without the site lookup.
      });
  }, []);

  useEffect(() => {
    clientPageApi.inspectRepair(project.id).then((result) => setRepairIssues(result.issues)).catch(() => setRepairIssues([]));
  }, [project.id, project.selectedImageIds]);

  const replaceSelection = async (selectedImageIds: string[]) => {
    try {
      setSelectionBusy(true);
      const result = await clientPageApi.replaceSelection(project.id, selectedImageIds);
      setProject(result.project);
      setShareUrl(result.shareUrl);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Failed to update client page selection.');
    } finally {
      setSelectionBusy(false);
    }
  };

  const handleToggleImage = async (imageId: string) => {
    const nextSelection = project.selectedImageIds.includes(imageId)
      ? removeImageId(project.selectedImageIds, imageId)
      : dedupeImageIds([...project.selectedImageIds, imageId]);
    await replaceSelection(nextSelection);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/client-pages" className="text-xs font-mono uppercase tracking-[0.2em] text-stone-500 hover:text-stone-900">
              Client pages
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold text-stone-900">{project.title}</h1>
              <ClientPageStatusBadge status={project.status} />
            </div>
            <p className="mt-2 max-w-3xl text-sm text-stone-600">
              Manage explicit membership for this client page, link it to a dedicated client site, then publish or revise it in that deployed worker.
            </p>
          </div>
          <div className="text-right text-xs font-mono text-stone-500">
            <div>{project.selectedImageIds.length} selected assets</div>
            <div>{project.remoteProjectId ? 'Remote project linked' : 'Not published yet'}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr),320px]">
        <div className="space-y-6">
          <ClientPageMetadataForm
            project={project}
            clientSites={clientSites}
            busy={metadataBusy}
            onSave={async (payload) => {
              try {
                setMetadataBusy(true);
                const result = await clientPageApi.updateProject(project.id, payload);
                setProject(result.project);
                setShareUrl(result.shareUrl);
                toast.push('Client page details saved.');
              } catch (error) {
                toast.push(error instanceof Error ? error.message : 'Failed to save project details.');
              } finally {
                setMetadataBusy(false);
              }
            }}
          />

          <ClientPagePublishPanel
            project={project}
            shareUrl={shareUrl}
            publishBusy={publishBusy}
            lifecycleBusy={lifecycleBusy}
            onPublish={async () => {
              try {
                setPublishBusy(true);
                const result = await clientPageApi.publishProject(project.id);
                setProject(result.project);
                setShareUrl(result.shareUrl);
                toast.push('Client page published.');
              } catch (error) {
                toast.push(error instanceof Error ? error.message : 'Failed to publish client page.');
              } finally {
                setPublishBusy(false);
              }
            }}
            repairIssues={repairIssues}
            repairBusy={repairBusy}
            onRepair={async () => {
              const confirmed = window.confirm(
                `Remove ${repairIssues.length} unusable asset(s) from this client page? The source assets will remain in Photarium.`
              );
              if (!confirmed) return;
              try {
                setRepairBusy(true);
                const result = await clientPageApi.repairProject(project.id);
                setProject(result.project);
                setShareUrl(result.shareUrl);
                setRepairIssues([]);
                toast.push(`Removed ${result.removedAssets.length} unusable asset(s). You can add new assets and publish again.`);
              } catch (error) {
                toast.push(error instanceof Error ? error.message : 'Failed to repair client page assets.');
              } finally {
                setRepairBusy(false);
              }
            }}
            onCopyLink={async () => {
              if (!shareUrl) return;
              try {
                await navigator.clipboard.writeText(shareUrl);
                toast.push('Client link copied.');
              } catch {
                toast.push('Failed to copy client link.');
              }
            }}
            onShadow={async () => {
              try {
                setLifecycleBusy(true);
                const result = await clientPageApi.shadowProject(project.id);
                setProject(result.project);
                setShareUrl(result.shareUrl);
                toast.push('Client page shadowed.');
              } catch (error) {
                toast.push(error instanceof Error ? error.message : 'Failed to shadow client page.');
              } finally {
                setLifecycleBusy(false);
              }
            }}
            onArchive={async () => {
              try {
                setLifecycleBusy(true);
                const result = await clientPageApi.archiveProject(project.id);
                setProject(result.project);
                setShareUrl(result.shareUrl);
                toast.push('Client page archived.');
              } catch (error) {
                toast.push(error instanceof Error ? error.message : 'Failed to archive client page.');
              } finally {
                setLifecycleBusy(false);
              }
            }}
          />
        </div>

        <ClientPageAssetPicker
          initialNamespace={project.sourceNamespaces.length === 1 ? project.sourceNamespaces[0] : '__all__'}
          selectedImageIds={project.selectedImageIds}
          busy={selectionBusy}
          onImagesLoaded={setCatalogImages}
          onToggleImage={handleToggleImage}
          onAddMany={(imageIds) => replaceSelection(dedupeImageIds([...project.selectedImageIds, ...imageIds]))}
          onRemoveMany={(imageIds) =>
            replaceSelection(project.selectedImageIds.filter((imageId) => !imageIds.includes(imageId)))
          }
        />

        <ClientPageSelectionPanel
          selectedImages={selectedImages}
          busy={selectionBusy}
          onRemove={(imageId) => replaceSelection(removeImageId(project.selectedImageIds, imageId))}
          onMoveUp={(imageId) => replaceSelection(moveImageId(project.selectedImageIds, imageId, -1))}
          onMoveDown={(imageId) => replaceSelection(moveImageId(project.selectedImageIds, imageId, 1))}
        />
      </div>
    </div>
  );
}
