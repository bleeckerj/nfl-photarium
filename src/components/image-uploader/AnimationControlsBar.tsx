interface AnimationControlsBarProps {
  visible: boolean;
  animateFps: string;
  setAnimateFps: (value: string) => void;
  setAnimateFpsTouched: (value: boolean) => void;
  animateLoop: boolean;
  setAnimateLoop: (value: boolean) => void;
  animateFilename: string;
  setAnimateFilename: (value: string) => void;
  animateLoading: boolean;
  animateError: string | null;
  selectedQueuedCount: number;
  onCreateAnimation: () => void;
}

export default function AnimationControlsBar({
  visible,
  animateFps,
  setAnimateFps,
  setAnimateFpsTouched,
  animateLoop,
  setAnimateLoop,
  animateFilename,
  setAnimateFilename,
  animateLoading,
  animateError,
  selectedQueuedCount,
  onCreateAnimation,
}: AnimationControlsBarProps) {
  if (!visible) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 rounded-lg border border-blue-200 bg-white/70 p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          FPS
          <input
            type="number"
            min="0.1"
            step="0.5"
            value={animateFps}
            onChange={(event) => {
              setAnimateFpsTouched(true);
              setAnimateFps(event.target.value);
            }}
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          Loop
          <input
            type="checkbox"
            checked={animateLoop}
            onChange={(event) => setAnimateLoop(event.target.checked)}
            className="h-3 w-3"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          Output name
          <input
            type="text"
            value={animateFilename}
            onChange={(event) => setAnimateFilename(event.target.value)}
            placeholder="animated-webp"
            className="w-40 rounded-md border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCreateAnimation}
          disabled={animateLoading || selectedQueuedCount < 2}
          className="rounded-md bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {animateLoading ? 'Building...' : 'Create animated WebP'}
        </button>
        {animateError && <p className="text-[11px] text-red-600">{animateError}</p>}
      </div>
    </div>
  );
}
