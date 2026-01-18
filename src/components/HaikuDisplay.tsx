'use client';

import { useState } from 'react';
import { Feather, RefreshCw } from 'lucide-react';

interface HaikuDisplayProps {
  imageId: string;
  hasClipEmbedding?: boolean;
}

interface HaikuResponse {
  haiku: string;
  lines: string[];
  conceptScores: Array<{ trait: string; intensity: number }>;
}

/**
 * HaikuDisplay - Generates and displays AI haiku from CLIP embeddings
 * 
 * Uses the semantic qualities perceived by the neural network to create
 * a poetic interpretation of the image's "machine soul".
 */
export function HaikuDisplay({ imageId, hasClipEmbedding }: HaikuDisplayProps) {
  const [haiku, setHaiku] = useState<HaikuResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateHaiku = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/images/${imageId}/haiku`, {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || 'Failed to generate haiku');
        return;
      }
      
      setHaiku(data);
    } catch (err) {
      setError('Failed to connect to haiku service');
      console.error('[HaikuDisplay] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!hasClipEmbedding) {
    return (
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-stone-400 text-sm">
          <Feather className="h-4 w-4" />
          <span className="font-3270">Haiku requires CLIP embedding</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-stone-50 to-amber-50/30 border border-stone-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 border-b border-stone-200 bg-white/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-stone-600">
          <Feather className="h-4 w-4" />
          <span className="font-3270 text-xs uppercase tracking-wider">Machine Haiku</span>
        </div>
        <button
          onClick={generateHaiku}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-3270 uppercase tracking-wide rounded-full bg-stone-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {loading ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" />
              Channeling...
            </>
          ) : haiku ? (
            <>
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </>
          ) : (
            <>
              <Feather className="h-3 w-3" />
              Generate
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="p-6">
        {error && (
          <p className="text-red-600 text-sm font-mono">{error}</p>
        )}
        
        {!haiku && !loading && !error && (
          <p className="text-stone-400 text-sm font-3270 italic text-center py-4">
            Click generate to create a haiku from the machine&apos;s perception
          </p>
        )}

        {loading && !haiku && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
            <p className="text-stone-500 text-xs font-3270 uppercase tracking-wider">
              Traversing latent space...
            </p>
          </div>
        )}

        {haiku && (
          <div className="space-y-4">
            {/* The Haiku */}
            <div className="text-center space-y-1">
              {haiku.lines.map((line, idx) => (
                <p 
                  key={idx} 
                  className="font-3270 text-lg text-stone-800 tracking-wide"
                  style={{ 
                    opacity: 0,
                    animation: `fadeSlideIn 0.6s ease-out ${idx * 0.3}s forwards`
                  }}
                >
                  {line}
                </p>
              ))}
            </div>

            {/* Semantic traits that inspired this */}
            {haiku.conceptScores && haiku.conceptScores.length > 0 && (
              <div className="pt-4 border-t border-stone-200">
                <p className="text-[0.65rem] font-3270 uppercase tracking-wider text-stone-400 mb-2 text-center">
                  Perceived qualities
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {haiku.conceptScores.map((score, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.6rem] font-3270 uppercase tracking-wide"
                      style={{
                        backgroundColor: `rgba(120, 113, 108, ${0.1 + score.intensity * 0.3})`,
                        color: score.intensity > 0.2 ? '#44403c' : '#78716c',
                      }}
                    >
                      {score.trait}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS for animation */}
      <style jsx>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

export default HaikuDisplay;
