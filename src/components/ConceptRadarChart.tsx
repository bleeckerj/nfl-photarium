'use client';

import { Search } from 'lucide-react';
import type React from 'react';
import type { ConceptScore } from '@/components/ConceptRadar';

type RadarPoint = { x: number; y: number; amplifiedScore: number };
type AxisLine = { x1: number; y1: number; x2: number; y2: number };
type ClickTarget = { x: number; y: number };

type ConceptRadarChartProps = {
  concepts: ConceptScore[];
  size: number;
  cx: number;
  cy: number;
  radius: number;
  n: number;
  gridCircles: number[];
  axisLines: AxisLine[];
  polygonPath: string;
  points: RadarPoint[];
  clickTarget: ClickTarget | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onRadarClick: (event: React.MouseEvent<SVGSVGElement>) => void;
};

export function ConceptRadarChart({
  concepts, size, cx, cy, radius, n, gridCircles, axisLines, polygonPath, points, clickTarget, svgRef, onRadarClick,
}: ConceptRadarChartProps) {
  return (
    <div>
      <svg 
        ref={svgRef}
        width={size} 
        height={size} 
        className="overflow-visible cursor-crosshair"
        onClick={onRadarClick}
      >
        {/* Clickable background */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="rgba(0,0,0,0.02)"
          className="hover:fill-blue-500/5 transition-colors"
        />

        {/* Grid circles */}
        {gridCircles.map((r, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#374151"
            strokeWidth="1"
            opacity={0.5}
            pointerEvents="none"
          />
        ))}

        {/* Axis lines */}
        {axisLines.map((line, i) => (
          <line
            key={i}
            {...line}
            stroke="#374151"
            strokeWidth="1"
            opacity={0.5}
            pointerEvents="none"
          />
        ))}

        {/* Center line (neutral) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius * 0.5}
          fill="none"
          stroke="#6b7280"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity={0.7}
          pointerEvents="none"
        />

        {/* Data polygon */}
        <path
          d={polygonPath}
          fill="rgba(59, 130, 246, 0.3)"
          stroke="#3b82f6"
          strokeWidth="2"
          pointerEvents="none"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill="#3b82f6"
            stroke="white"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        ))}

        {/* Click target marker */}
        {clickTarget && (
          <>
            <circle
              cx={clickTarget.x}
              cy={clickTarget.y}
              r={8}
              fill="rgba(251, 191, 36, 0.8)"
              stroke="#f59e0b"
              strokeWidth="2"
              pointerEvents="none"
            />
            <circle
              cx={clickTarget.x}
              cy={clickTarget.y}
              r={3}
              fill="#f59e0b"
              pointerEvents="none"
            />
          </>
        )}

        {/* Labels */}
        {concepts.map((concept, i) => {
          const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
          const labelRadius = radius + 28;
          const x = cx + labelRadius * Math.cos(angle);
          const y = cy + labelRadius * Math.sin(angle);
          
          // Determine which label to show based on amplified score
          const amplifiedScore = points[i].amplifiedScore;
          const label = amplifiedScore >= 0 ? concept.positive : concept.negative;
          const intensity = Math.abs(amplifiedScore);
          const opacity = 0.4 + intensity * 0.6;
          
          // Adjust text anchor based on position
          let textAnchor: 'start' | 'middle' | 'end' = 'middle';
          if (Math.cos(angle) > 0.1) textAnchor = 'start';
          if (Math.cos(angle) < -0.1) textAnchor = 'end';

          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              className="font-3270 pointer-events-none select-none"
              style={{ 
                fill: amplifiedScore >= 0 ? '#34d399' : '#f87171',
                opacity,
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {label}
            </text>
          );
        })}
      </svg>
      
      {/* Legend showing strongest traits */}
      <div className="mt-3 space-y-1">
        <p className="text-[10px] font-3270 uppercase tracking-wider text-gray-500 text-center">
          Dominant Perceptions
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {[...concepts]
            .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
            .slice(0, 3)
            .map((concept, i) => {
              const trait = concept.score >= 0 ? concept.positive : concept.negative;
              const isPositive = concept.score >= 0;
              return (
                <span
                  key={i}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-3270 uppercase tracking-wide"
                  style={{
                    backgroundColor: isPositive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                    color: isPositive ? '#34d399' : '#f87171',
                  }}
                  title={`Raw score: ${(concept.score * 100).toFixed(1)}%`}
                >
                  {trait}
                </span>
              );
            })}
        </div>
        <p className="text-[9px] text-gray-500 text-center mt-2 flex items-center justify-center gap-1">
          <Search className="h-3 w-3" />
          Click anywhere to find matching images
        </p>
      </div>
    </div>
  );
}

