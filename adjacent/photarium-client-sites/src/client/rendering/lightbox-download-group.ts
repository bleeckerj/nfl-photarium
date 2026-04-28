import type { ClientAsset, ClientProject } from '@client/domain/types';
import { resolveVideoPlayback } from '@client/rendering/media';

interface LightboxDownloadGroupOptions {
  asset: ClientAsset;
  project: ClientProject;
}

export const renderLightboxDownloadGroups = (
  options: LightboxDownloadGroupOptions
): HTMLElement => {
  const downloads = document.createElement('div');
  downloads.className = 'lightbox__downloads';

  if (options.asset.assetType === 'video') {
    const playback = resolveVideoPlayback(options.asset);
    const group = document.createElement('section');
    group.className = 'lightbox__download-group';

    const title = document.createElement('h3');
    title.className = 'lightbox__download-title';
    title.textContent = 'Video';

    const links = document.createElement('div');
    links.className = 'lightbox__download-links';

    [
      { href: playback.hasPlayableSource ? playback.playUrl : null, label: 'Play' },
      { href: playback.hasDownloadableSource ? playback.downloadUrl : null, label: 'Download' },
      { href: options.asset.videoHlsUrl, label: 'HLS' },
    ].filter((entry) => entry.href).forEach((entry) => {
      const link = document.createElement('a');
      link.className = 'button button--ghost lightbox__download-link';
      link.href = entry.href!;
      link.textContent = entry.label;
      link.target = '_blank';
      link.rel = 'noreferrer';
      links.append(link);
    });

    group.append(title, links);
    downloads.append(group);
    return downloads;
  }

  options.project.delivery.downloadPresets.forEach((preset) => {
    const group = document.createElement('section');
    group.className = 'lightbox__download-group';

    const title = document.createElement('h3');
    title.className = 'lightbox__download-title';
    title.textContent = preset.label;

    const links = document.createElement('div');
    links.className = 'lightbox__download-links';

    options.project.delivery.allowedOutputFormats.forEach((format) => {
      const link = document.createElement('a');
      link.className = 'button button--ghost lightbox__download-link';
      link.href = `/d/${options.asset.id}/${preset.name}.${format}`;
      link.textContent = format.toUpperCase();
      links.append(link);
    });

    group.append(title, links);
    downloads.append(group);
  });

  return downloads;
};
