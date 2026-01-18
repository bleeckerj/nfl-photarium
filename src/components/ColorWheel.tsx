'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';

interface ColorWheelProps {
  value: string;
  onChange: (color: string) => void;
  size?: number;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  // Remove # if present
  hex = hex.replace(/^#/, '');
  
  // Parse hex
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }

  return { h, s: s * 100, l: l * 100 };
}

export default function ColorWheel({ value, onChange, size = 180 }: ColorWheelProps) {
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hsl, setHsl] = useState(() => {
    try {
      return hexToHsl(value || '#3B82F6');
    } catch {
      return { h: 217, s: 91, l: 60 };
    }
  });

  // Draw the color wheel
  useEffect(() => {
    const canvas = wheelRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = size / 2;
    const centerY = size / 2;
    const outerRadius = size / 2 - 8;
    const innerRadius = outerRadius * 0.65;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw hue wheel
    for (let angle = 0; angle < 360; angle += 1) {
      const startAngle = (angle - 1) * Math.PI / 180;
      const endAngle = (angle + 1) * Math.PI / 180;

      ctx.beginPath();
      ctx.moveTo(centerX + innerRadius * Math.cos(startAngle), centerY + innerRadius * Math.sin(startAngle));
      ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
      ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
      ctx.closePath();

      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
      ctx.fill();
    }

    // Draw saturation/lightness gradient in center
    const gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, innerRadius - 4
    );
    gradient.addColorStop(0, 'white');
    gradient.addColorStop(0.5, `hsl(${hsl.h}, 100%, 50%)`);
    gradient.addColorStop(1, 'black');

    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius - 4, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw current hue indicator on wheel
    const hueAngle = hsl.h * Math.PI / 180;
    const indicatorRadius = (outerRadius + innerRadius) / 2;
    const indicatorX = centerX + indicatorRadius * Math.cos(hueAngle);
    const indicatorY = centerY + indicatorRadius * Math.sin(hueAngle);

    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, 8, 0, Math.PI * 2);
    ctx.fillStyle = hslToHex(hsl.h, 100, 50);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw saturation/lightness indicator in center
    const slRadius = innerRadius - 4;
    const slAngle = (hsl.s / 100) * Math.PI * 2 - Math.PI / 2;
    const slDistance = (1 - hsl.l / 100) * slRadius;
    const slX = centerX + slDistance * Math.cos(slAngle) * (hsl.s / 100);
    const slY = centerY + slDistance * Math.sin(slAngle) * (hsl.s / 100);

    ctx.beginPath();
    ctx.arc(slX, slY, 6, 0, Math.PI * 2);
    ctx.fillStyle = value || '#3B82F6';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [size, hsl, value]);

  const handleWheelInteraction = useCallback((clientX: number, clientY: number) => {
    const canvas = wheelRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - size / 2;
    const y = clientY - rect.top - size / 2;
    const distance = Math.sqrt(x * x + y * y);
    
    const outerRadius = size / 2 - 8;
    const innerRadius = outerRadius * 0.65;

    // Check if clicking on hue wheel
    if (distance >= innerRadius && distance <= outerRadius) {
      let angle = Math.atan2(y, x) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      
      const newHsl = { ...hsl, h: angle };
      setHsl(newHsl);
      onChange(hslToHex(newHsl.h, newHsl.s, newHsl.l));
    }
    // Check if clicking in center (saturation/lightness area)
    else if (distance < innerRadius - 4) {
      const normalizedDistance = distance / (innerRadius - 4);
      const lightness = 100 - normalizedDistance * 50;
      const saturation = Math.min(100, normalizedDistance * 100);
      
      const newHsl = { ...hsl, s: saturation, l: lightness };
      setHsl(newHsl);
      onChange(hslToHex(newHsl.h, newHsl.s, newHsl.l));
    }
  }, [hsl, onChange, size]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleWheelInteraction(e.clientX, e.clientY);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      handleWheelInteraction(e.clientX, e.clientY);
    }
  }, [isDragging, handleWheelInteraction]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Sync from external value changes
  useEffect(() => {
    if (value && /^#[0-9A-Fa-f]{6}$/.test(value)) {
      try {
        const newHsl = hexToHsl(value);
        // Only update if significantly different to avoid feedback loops
        if (Math.abs(newHsl.h - hsl.h) > 1 || Math.abs(newHsl.s - hsl.s) > 1 || Math.abs(newHsl.l - hsl.l) > 1) {
          setHsl(newHsl);
        }
      } catch {
        // Invalid hex, ignore
      }
    }
  }, [value, hsl.h, hsl.s, hsl.l]);

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={wheelRef}
        width={size}
        height={size}
        onMouseDown={handleMouseDown}
        className="cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      
      {/* Lightness slider */}
      <div className="w-full px-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-gray-400 w-16">Lightness</span>
          <input
            type="range"
            min="10"
            max="90"
            value={hsl.l}
            onChange={(e) => {
              const newHsl = { ...hsl, l: Number(e.target.value) };
              setHsl(newHsl);
              onChange(hslToHex(newHsl.h, newHsl.s, newHsl.l));
            }}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, 
                ${hslToHex(hsl.h, hsl.s, 10)}, 
                ${hslToHex(hsl.h, hsl.s, 50)}, 
                ${hslToHex(hsl.h, hsl.s, 90)})`
            }}
          />
        </div>
        
        {/* Saturation slider */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 w-16">Saturation</span>
          <input
            type="range"
            min="0"
            max="100"
            value={hsl.s}
            onChange={(e) => {
              const newHsl = { ...hsl, s: Number(e.target.value) };
              setHsl(newHsl);
              onChange(hslToHex(newHsl.h, newHsl.s, newHsl.l));
            }}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, 
                ${hslToHex(hsl.h, 0, hsl.l)}, 
                ${hslToHex(hsl.h, 100, hsl.l)})`
            }}
          />
        </div>
      </div>

      {/* Selected color preview */}
      <div className="flex items-center gap-3 w-full px-2">
        <div 
          className="w-10 h-10 rounded-lg border-2 border-white/30 shadow-lg"
          style={{ backgroundColor: value || '#3B82F6' }}
        />
        <div className="flex-1">
          <input
            type="text"
            value={value || '#3B82F6'}
            onChange={(e) => {
              const newValue = e.target.value.toUpperCase();
              if (/^#[0-9A-F]{0,6}$/.test(newValue)) {
                onChange(newValue);
              }
            }}
            placeholder="#3B82F6"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-[12px] text-gray-100 font-mono focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>

      {/* Quick color presets */}
      <div className="flex flex-wrap gap-1.5 justify-center px-2">
        {[
          '#FF0000', '#FF8000', '#FFFF00', '#80FF00',
          '#00FF00', '#00FF80', '#00FFFF', '#0080FF',
          '#0000FF', '#8000FF', '#FF00FF', '#FF0080',
          '#FFFFFF', '#808080', '#000000', '#8B4513',
        ].map((color) => (
          <button
            key={color}
            onClick={() => {
              onChange(color);
              setHsl(hexToHsl(color));
            }}
            className="w-5 h-5 rounded border border-white/20 hover:scale-125 transition-transform hover:border-white/50"
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
}
