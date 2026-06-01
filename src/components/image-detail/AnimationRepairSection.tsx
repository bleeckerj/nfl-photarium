import type { CloudflareImage } from './types';

export const AnimationRepairSection = ({
  image,
  loading,
  error,
  onReverse,
}: {
  image: CloudflareImage;
  loading: null | 'copy' | 'replace';
  error: string | null;
  onReverse: (replaceOriginal: boolean) => void;
}) => {
  const provenance = image.animatedWebp;
  const sourceFrameCount = provenance?.sourceImageIds?.length ?? 0;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Animation</h2>
          <p className="mt-1 text-xs font-mono text-gray-600">
            {sourceFrameCount > 0
              ? `${sourceFrameCount} source frame${sourceFrameCount === 1 ? '' : 's'}`
              : 'Source frame metadata unavailable'}
            {provenance?.orderMode ? ` - ${provenance.orderMode}` : ''}
            {typeof provenance?.fps === 'number' ? ` - ${provenance.fps} fps` : ''}
            {typeof provenance?.loop === 'boolean' ? ` - loop=${provenance.loop ? 'yes' : 'no'}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onReverse(false)}
            disabled={loading !== null}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {loading === 'copy' ? 'Creating...' : 'Create reversed copy'}
          </button>
          <button
            type="button"
            onClick={() => onReverse(true)}
            disabled={loading !== null}
            className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-mono text-red-800 hover:bg-red-100 disabled:opacity-50"
          >
            {loading === 'replace' ? 'Replacing...' : 'Replace with reversed version'}
          </button>
        </div>
      </div>
      <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] font-mono text-amber-800">
        Replacement uploads a new Cloudflare image ID, deletes this image only after the upload succeeds, and breaks any external URLs that use this ID.
      </p>
      {error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] font-mono text-red-700">
          {error}
        </p>
      )}
    </section>
  );
};
