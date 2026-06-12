import Image from 'next/image';

export type ComfyDetectionLike = {
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
};

export function isComfyDetected(asset: ComfyDetectionLike | null | undefined): boolean {
  const generatedBy = typeof asset?.generatedBy === 'string' ? asset.generatedBy.toLowerCase() : '';
  return generatedBy === 'comfyui' || asset?.comfyMetadataDetected === true || Boolean(asset?.comfyMetadataSource);
}

export function ComfyIndicator({
  asset,
  id,
  showLabel = true,
}: {
  asset: ComfyDetectionLike | null | undefined;
  id?: string;
  showLabel?: boolean;
}) {
  if (!isComfyDetected(asset)) return null;

  return (
    <span
      id={id}
      className={
        showLabel
          ? 'inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700'
          : 'inline-flex items-center justify-center rounded-md border border-gray-200 bg-white/95 p-1 shadow'
      }
      title="ComfyUI output detected"
      aria-label="ComfyUI output detected"
    >
      <Image
        src="/icons/comfyui.svg"
        alt="ComfyUI"
        width={showLabel ? 14 : 12}
        height={showLabel ? 14 : 12}
        className={showLabel ? 'h-3.5 w-3.5' : 'h-3 w-3'}
      />
      {showLabel ? 'ComfyUI' : null}
    </span>
  );
}
