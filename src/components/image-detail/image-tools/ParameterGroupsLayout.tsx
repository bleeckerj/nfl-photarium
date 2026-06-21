'use client';

import { useMemo, useState } from 'react';

import type { ImageToolControl } from '@/services/imageToolsService';
import { ControlGroupConsole } from '@/components/image-detail/image-tools/ControlFields';
import type { ControlGroup, ToolValues } from '@/components/image-detail/image-tools/controlModel';

type ControlChangeHandler = (control: ImageToolControl, value: string | boolean) => void;

const splitGroupsIntoColumns = (groups: ControlGroup[], columnCount: number) => {
  const columns = Array.from({ length: columnCount }, () => [] as ControlGroup[]);
  groups.forEach((group, index) => {
    columns[index % columnCount].push(group);
  });
  return columns;
};

const ParameterGroupCard = ({
  group,
  values,
  busy,
  onChange,
  advancedOpen,
  onAdvancedToggle,
}: {
  group: ControlGroup;
  values: ToolValues;
  busy: boolean;
  onChange: ControlChangeHandler;
  advancedOpen?: boolean;
  onAdvancedToggle: (groupId: string, open: boolean) => void;
}) => (
  <ControlGroupConsole
    group={group}
    values={values}
    busy={busy}
    onChange={onChange}
    advancedOpen={advancedOpen}
    onAdvancedToggle={onAdvancedToggle}
  />
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
  const [openAdvancedGroupIds, setOpenAdvancedGroupIds] = useState(() => new Set<string>());
  const handleAdvancedToggle = (groupId: string, open: boolean) => {
    setOpenAdvancedGroupIds((current) => {
      const next = new Set(current);
      if (open) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      return next;
    });
  };

  const visibleGroups = useMemo(() => {
    const regularGroups = groups.filter((group) => !group.advanced);
    const advancedGroups = groups.filter((group) => group.advanced);
    return {
      mobile: groups,
      advanced: advancedGroups,
      twoColumns: splitGroupsIntoColumns(regularGroups, 2),
      threeColumns: splitGroupsIntoColumns(regularGroups, 3),
    };
  }, [groups]);

  if (groups.length === 0) {
    return <p className="font-mono text-[10px] text-gray-500">No parameter controls for this effect.</p>;
  }

  const renderGroup = (group: ControlGroup) => (
    <ParameterGroupCard
      key={group.id}
      group={group}
      values={values}
      busy={busy}
      onChange={onChange}
      advancedOpen={group.advanced ? openAdvancedGroupIds.has(group.id) : undefined}
      onAdvancedToggle={handleAdvancedToggle}
    />
  );

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {visibleGroups.mobile.map(renderGroup)}
      </div>

      <div className="hidden gap-3 md:grid md:grid-cols-2 2xl:hidden">
        {visibleGroups.twoColumns.map((column, index) => (
          <div key={index} className="space-y-3">
            {column.map(renderGroup)}
          </div>
        ))}
      </div>

      {visibleGroups.advanced.length > 0 && (
        <div className="mt-3 hidden items-start gap-3 md:grid md:grid-cols-2 2xl:hidden">
          {visibleGroups.advanced.map((group) => (
            <div
              key={group.id}
              className={openAdvancedGroupIds.has(group.id) ? 'md:col-span-2' : undefined}
            >
              {renderGroup(group)}
            </div>
          ))}
        </div>
      )}

      <div className="hidden gap-3 2xl:grid 2xl:grid-cols-3">
        {visibleGroups.threeColumns.map((column, index) => (
          <div key={index} className="space-y-3">
            {column.map(renderGroup)}
          </div>
        ))}
      </div>

      {visibleGroups.advanced.length > 0 && (
        <div className="mt-3 hidden items-start gap-3 2xl:grid 2xl:grid-cols-3">
          {visibleGroups.advanced.map((group) => (
            <div
              key={group.id}
              className={openAdvancedGroupIds.has(group.id) ? '2xl:col-span-3' : undefined}
            >
              {renderGroup(group)}
            </div>
          ))}
        </div>
      )}
    </>
  );
};
