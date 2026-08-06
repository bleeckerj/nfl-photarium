'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  getTagSuggestions,
  parseTagDraft,
  serializeTagDraft,
  submitTag,
  type TagCorpusEntry,
} from './tagEditor';

type TagPillEditorProps = {
  value: string;
  corpus: readonly TagCorpusEntry[];
  corpusLoading: boolean;
  corpusError: string | null;
  onChange: (value: string) => void;
};

const normalizeInput = (value: string) => value.replace(/[-‐‑‒–—―﹘﹣－]+/gu, ' ');

export function TagPillEditor({
  value,
  corpus,
  corpusLoading,
  corpusError,
  onChange,
}: TagPillEditorProps) {
  const listboxId = useId();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const draft = useMemo(() => parseTagDraft(value), [value]);
  const suggestions = useMemo(
    () => getTagSuggestions(input, corpus, draft.semanticTags),
    [corpus, draft.semanticTags, input]
  );
  const suggestionsOpen = focused && input.trim().length > 0 && suggestions.length > 0;

  const updateDraft = (semanticTags: string[], controlTags = draft.controlTags) => {
    onChange(serializeTagDraft({ semanticTags, controlTags }));
  };

  const removeTag = (tag: string) => {
    updateDraft(draft.semanticTags.filter((candidate) => candidate !== tag));
    setFeedback(null);
  };

  const addTag = (candidateInput: string) => {
    const submission = submitTag(candidateInput, draft.semanticTags, corpus);
    if (!submission.ok) {
      setFeedback(submission.message);
      return;
    }

    updateDraft([...draft.semanticTags, submission.tag]);
    setInput('');
    setHighlightedIndex(0);
    setFeedback(
      submission.source === 'corrected'
        ? 'Added “' + submission.tag + '” from the tag corpus.'
        : submission.source === 'custom'
          ? 'Added custom tag.'
          : null
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestionsOpen) {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && suggestionsOpen) {
      event.preventDefault();
      setHighlightedIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Escape' && suggestionsOpen) {
      event.preventDefault();
      setFocused(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      addTag(suggestionsOpen ? suggestions[highlightedIndex]?.value ?? input : input);
      return;
    }
    if (event.key === 'Backspace' && !input && draft.semanticTags.length > 0) {
      event.preventDefault();
      removeTag(draft.semanticTags[draft.semanticTags.length - 1]);
    }
  };

  return (
    <div className="relative mt-2" data-testid="tag-pill-editor">
      <div className="overflow-hidden rounded-md border border-gray-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <div
          className="grid min-h-[4.75rem] max-h-48 grid-flow-col auto-cols-max justify-start gap-x-[7px] gap-y-[6px] overflow-x-auto overflow-y-hidden p-2 [grid-template-rows:repeat(3,min-content)] max-sm:[grid-template-rows:repeat(4,min-content)]"
          data-testid="tag-pill-grid"
        >
          {draft.semanticTags.map((tag) => (
            <span
              className="inline-flex w-full min-w-max items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700"
              key={tag}
            >
              <span className="max-w-[18rem] truncate">{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-sm leading-none text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                aria-label={'Remove ' + tag}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="border-t border-gray-200 px-3 py-2">
          <input
            value={input}
            onChange={(event) => {
              setInput(normalizeInput(event.target.value));
              setHighlightedIndex(0);
              setFeedback(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 0)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-xs outline-none placeholder:text-gray-400"
            placeholder="Type a tag and press Enter…"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={suggestionsOpen}
            aria-activedescendant={suggestionsOpen ? listboxId + '-' + highlightedIndex : undefined}
          />
        </div>
      </div>
      {suggestionsOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 text-xs shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              id={listboxId + '-' + index}
              key={suggestion.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addTag(suggestion.value)}
              className={
                index === highlightedIndex
                  ? 'flex w-full items-center justify-between rounded bg-blue-50 px-2 py-1.5 text-left text-blue-900'
                  : 'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-gray-700 hover:bg-gray-50'
              }
            >
              <span>{suggestion.value}</span>
              <span className="ml-4 text-[10px] text-gray-400">{suggestion.count}</span>
            </button>
          ))}
        </div>
      )}
      <p
        className={feedback ? 'mt-1 min-h-5 text-[10px] text-red-600' : 'mt-1 min-h-5 text-[10px] text-gray-500'}
        aria-live="polite"
      >
        {feedback ?? (
          corpusLoading
            ? 'Loading tag suggestions…'
            : corpusError
              ? 'Suggestions unavailable; custom tags remain available.'
              : 'Type to search the tag corpus. Hyphens become spaces.'
        )}
      </p>
    </div>
  );
}
