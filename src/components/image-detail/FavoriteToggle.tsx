import { Star } from 'lucide-react';

export function FavoriteToggle(props: {
  favorite: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { favorite, loading, onToggle } = props;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono transition disabled:opacity-50 ${
        favorite
          ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={favorite}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Star className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
      {loading ? 'Saving…' : favorite ? 'Favorited' : 'Favorite'}
    </button>
  );
}
