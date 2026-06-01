import Image from 'next/image';

export type HoverPreviewState = {
  url: string;
  label: string;
  x: number;
  y: number;
};

export const HoverPreviewOverlay = ({ preview }: { preview: HoverPreviewState }) => (
  <div
    className="fixed z-50 pointer-events-none border border-black/10 shadow-lg rounded-lg overflow-hidden bg-white"
    style={{ top: preview.y, left: preview.x, width: 340, height: 280 }}
  >
    <Image
      src={preview.url}
      alt={preview.label}
      fill
      className="object-contain"
      unoptimized
    />
  </div>
);
