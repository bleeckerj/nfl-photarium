import type { SubmissionState } from '../domain/types';

export const clientCopy = {
  reviewBarEyebrow: 'Client selection',
  reviewSummary: 'Browse the set, open any asset for detail, and mark the ones you want included.',
  toolbarHelper: 'Filter by visible tags. Open any asset for downloads, playback, and a larger review.',
  emptyGallery: 'No assets match this filter.',
  projectUnavailableTitle: 'Project unavailable',
  projectUnavailableFallback: 'The project could not be loaded.',
  projectRouteMissing: 'Open a seeded project URL, not the worker root.',
  projectNotFound: 'The requested project could not be found.',
  projectInaccessible: 'This project is unavailable or no longer published.',
  projectInvalidAccessKey: 'The shared link is invalid or has expired.',
  projectMissingSession: 'The project session is missing or expired. Reopen the shared link.',
  allTagsLabel: 'All',
  reviewShortlist: 'Review shortlist',
  hideShortlist: 'Hide selection',
  shortlistTitle: 'Selected assets',
  shortlistEmpty: 'No assets selected yet.',
  shortlistSummary: 'Review the marked assets before sending.',
  selectionDetailsTitle: 'Selection details',
  sendSelection: 'Send selection',
  hideForm: 'Hide form',
  remove: 'Remove',
  addToShortlist: 'Add to shortlist',
  removeFromShortlist: 'Remove from shortlist',
  addCardSelection: 'Add',
  addedCardSelection: 'Added',
  lightboxBack: 'Back to grid',
  previousImage: 'Previous',
  nextImage: 'Next',
  downloadTitle: 'Downloads',
  playbackTitle: 'Playback',
  clusterLabel: 'Cluster',
  tagsLabel: 'Tags',
  noDescription: 'No description provided.',
  localDevTitle: 'Local development',
  localDevSummary: 'Create or resume a seeded client-site demo from this local worker.',
  localDevToolbar: 'Start a fresh preview or reopen the last project route saved in this browser.',
  localDevIntro: 'The worker is running locally. Use this page to launch a fresh client-selection preview.',
  localDevStatusUnavailable: 'The local worker did not return a usable development status payload.',
  localDevWorkerStatusLabel: 'Worker status',
  localDevWorkerStatusReady: 'running',
  localDevWorkerStatusLoading: 'checking',
  localDevWorkerStatusError: 'unavailable',
  localDevOriginLabel: 'Active origin',
  localDevEnvironmentLabel: 'Environment',
  localDevUnknownValue: 'unknown',
  localDevCreateDemo: 'Create fresh demo',
  localDevCreatingDemo: 'Creating demo',
  localDevResumeDemo: 'Resume last demo',
  localDevResumeAvailable: 'A previously opened project route is available in this browser.',
  localDevNoLastProject: 'No prior local project route is stored in this browser yet.',
} as const;

export const getSubmissionStatusCopy = (state: SubmissionState): string => {
  switch (state) {
    case 'submitting':
      return 'Sending selection';
    case 'submitted':
      return 'Selection sent';
    case 'error':
      return 'Selection failed. Try again.';
    default:
      return '';
  }
};

export const getLightboxPositionCopy = (assetIndex: number, assetCount: number): string =>
  `Asset ${assetIndex + 1} / ${assetCount}`;

export const getShortlistCountCopy = (count: number): string =>
  count === 0 ? clientCopy.shortlistEmpty : `${count} asset${count === 1 ? '' : 's'} selected`;
