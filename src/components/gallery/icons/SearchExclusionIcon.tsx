/**
 * SearchExclusionIcon Component
 * 
 * Icon indicating an image is excluded from search.
 */

import React from 'react';

interface SearchExclusionIconProps {
  className?: string;
  title?: string;
}

export const SearchExclusionIcon: React.FC<SearchExclusionIconProps> = ({ 
  className = '', 
  title = '' 
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-label={title}
  >
    <title>{title}</title>
    <path d="M2.71 2.29a1 1 0 00-1.42 1.42l2.5 2.5C2.26 7.8 1.1 9.79.39 11.55a1 1 0 000 .9c1.42 3.5 4.88 7.05 9.61 7.5v.05l2.29 2.29a1 1 0 001.42-1.42l-11-11.16zM12 6c3.79 0 7.17 2.13 8.82 5.5-.5 1.02-1.19 1.99-2.02 2.85l1.42 1.42c1.13-1.13 2.07-2.46 2.78-3.9a1 1 0 000-.87C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.56l1.57 1.57c.68-.09 1.38-.13 2.07-.13zM12 8a4 4 0 014 4c0 .35-.06.69-.15 1.02l-4.87-4.87c.33-.09.67-.15 1.02-.15z" />
    <line
      x1="1"
      y1="1"
      x2="23"
      y2="23"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
