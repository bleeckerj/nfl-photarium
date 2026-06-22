'use client';

import { useState } from 'react';

import type { ImageToolControl } from '@/services/imageToolsService';
import { ControlField } from '@/components/image-detail/image-tools/ControlFields';
import type { ControlGroup, ToolValues } from '@/components/image-detail/image-tools/controlModel';

type ControlChangeHandler = (control: ImageToolControl, value: string | boolean) => void;

const railButtonClass = (active: boolean) => (
  `flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left font-mono text-[11px] transition ${
    active
      ? 'border-gray-900 bg-white text-gray-950 ring-1 ring-gray-900'
      : 'border-transparent text-gray-600 hover:border-gray-300 hover:bg-white'
  }`
);

export const ParameterGroupsLayout = ({
  groups,
  values,
  busy,
  onChange,
}: {
  groups: ControlGroup[];
  values: ToolValues;
  busy: boolean;
  onChange: ControlChangeHandler;
}) => {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  if (groups.length === 0) {
    return <p className="font-mono text-[10px] text-gray-500">No parameter controls for this effect.</p>;
  }

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];

  return (
    <div className="grid gap-3 md:grid-cols-[11rem_minmax(0,1fr)] md:items-start">
      <nav
        aria-label="Parameter groups"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
      >
        {groups.map((group) => {
          const active = group.id === activeGroup.id;
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveGroupId(group.id)}
              className={`${railButtonClass(active)} shrink-0 md:shrink`}
            >
              <span className="truncate">{group.label}</span>
              {group.advanced && (
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-gray-400">adv</span>
              )}
            </button>
          );
        })}
      </nav>

      <section className="min-w-0 rounded border border-gray-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-2 font-mono text-[11px] font-semibold text-gray-800">
          <span>{activeGroup.label}</span>
          <span className="text-[10px] font-normal text-gray-500">
            {activeGroup.controls.length} control{activeGroup.controls.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="grid items-start gap-x-4 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
          {activeGroup.controls.map((control) => (
            <ControlField
              key={control.id}
              control={control}
              currentValue={values[control.id] ?? control.defaultValue ?? ''}
              busy={busy}
              onChange={onChange}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
