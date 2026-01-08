import { useEffect, useMemo, useRef, useState } from 'react';

type SelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type MonoSelectProps = {
  id?: string;
  name?: string;
  value?: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  size?: 'sm' | 'md';
};

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export default function MonoSelect({
  id,
  name,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className,
  searchable = false,
  searchPlaceholder = 'Type to filter…',
  size = 'md'
}: MonoSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const filteredOptions = useMemo(() => {
    if (!searchable) {
      return options;
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, searchable, searchQuery]);
  const selectedIndex = filteredOptions.findIndex((opt) => opt.value === value);
  const [highlightedIndex, setHighlightedIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : 0
  );

  useEffect(() => {
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [selectedIndex, filteredOptions.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => {
      const next = !prev;
      if (next && searchable) {
        setSearchQuery('');
      }
      return next;
    });
  };

  const handleOptionSelect = (index: number) => {
    const option = filteredOptions[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    let nextIndex = highlightedIndex;
    do {
      nextIndex =
        (nextIndex + direction + filteredOptions.length) % filteredOptions.length;
    } while (filteredOptions[nextIndex]?.disabled && nextIndex !== highlightedIndex);
    setHighlightedIndex(nextIndex);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (
      searchable &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      setOpen(true);
      setSearchQuery((prev) => `${prev}${event.key}`);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          moveHighlight(1);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          moveHighlight(-1);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!open) {
          setOpen(true);
        } else {
          handleOptionSelect(highlightedIndex);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        name={name}
        className={cn(
          'w-full border border-gray-300 rounded-md flex items-center justify-between gap-2 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono',
          size === 'sm' ? 'px-2 py-0.5 text-[0.7em] min-h-[20px]' : 'px-3 py-2 text-[0.9em]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id || 'mono-select'}-listbox` : undefined}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      >
        <span className={cn('truncate', !selectedOption && 'text-gray-400')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={cn(
            'h-4 w-4 text-gray-500 transition-transform',
            open && 'rotate-180'
          )}
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M5.5 7.5L10 12l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          id={id ? `${id}-listbox` : undefined}
          className="absolute z-40 mt-1 w-full max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-xl"
        >
          {searchable && (
            <div className="sticky top-0 bg-white border-b border-gray-200 px-2 py-2">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full border border-gray-200 rounded-md px-2 py-1 text-[0.85em] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-[0.9em] text-gray-400">
              {options.length === 0 ? 'No options available' : 'No matches found'}
            </div>
          ) : (
            filteredOptions.map((option, index) => (
              <button
                type="button"
                role="option"
                key={`${option.value}-${index}`}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={cn(
                  'w-full text-left px-3 py-2 font-mono transition',
                  size === 'sm' ? 'text-[0.8em]' : 'text-[0.9em]',
                  option.disabled
                    ? 'text-gray-400 cursor-not-allowed'
                    : option.value === value
                      ? 'bg-blue-50 text-blue-700'
                      : highlightedIndex === index
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-800 hover:bg-gray-50'
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleOptionSelect(index)}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
