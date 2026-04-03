import type { ClientProject } from '@client/domain/types';

interface LightboxDownloadGroupOptions {
  assetId: string;
  project: ClientProject;
}

export const renderLightboxDownloadGroups = (
  options: LightboxDownloadGroupOptions
): HTMLElement => {
  const downloads = document.createElement('div');
  downloads.className = 'lightbox__downloads';

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
      link.href = `/d/${options.assetId}/${preset.name}.${format}`;
      link.textContent = format.toUpperCase();
      links.append(link);
    });

    group.append(title, links);
    downloads.append(group);
  });

  return downloads;
};
