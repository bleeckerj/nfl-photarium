import type { ImageToolControl } from '@/services/imageToolsService';
import type { ControlGroup, ToolValues } from '@/components/image-detail/image-tools/controlModel';

type ControlChangeHandler = (control: ImageToolControl, value: string | boolean) => void;

export const ControlField = ({
  control,
  currentValue,
  busy,
  onChange,
}: {
  control: ImageToolControl;
  currentValue: string | number | boolean;
  busy: boolean;
  onChange: ControlChangeHandler;
}) => {
  if (control.type === 'switch') {
    return (
      <label className="flex items-center justify-between gap-3 rounded border border-gray-100 px-2 py-2 font-mono text-[11px] text-gray-700">
        <span>
          <span className="block">{control.label}</span>
          {control.helpText && <span className="block text-[10px] text-gray-500">{control.helpText}</span>}
        </span>
        <input
          type="checkbox"
          checked={Boolean(currentValue)}
          onChange={(event) => onChange(control, event.target.checked)}
          disabled={busy}
          className="h-4 w-4"
        />
      </label>
    );
  }

  if (control.type === 'select') {
    return (
      <label className="block font-mono text-[11px] text-gray-600">
        {control.label}
        <select
          value={String(currentValue)}
          onChange={(event) => onChange(control, event.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800"
        >
          {(control.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
        {control.helpText && <span className="mt-1 block text-[10px] font-normal text-gray-500">{control.helpText}</span>}
      </label>
    );
  }

  const inputType = control.type === 'color' ? 'color' : control.type === 'text' ? 'text' : 'number';
  return (
    <label className="block font-mono text-[11px] text-gray-600">
      <span className="flex items-center justify-between gap-2">
        <span>{control.label}</span>
        {control.type === 'slider' && <span className="text-[10px] text-gray-400">{String(currentValue)}</span>}
      </span>
      <input
        type={control.type === 'slider' ? 'range' : inputType}
        value={String(currentValue)}
        min={control.min}
        max={control.max}
        step={control.step}
        onChange={(event) => onChange(control, event.target.value)}
        disabled={busy}
        className={control.type === 'slider'
          ? 'mt-2 w-full accent-gray-900'
          : 'mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800'}
      />
      {control.helpText && <span className="mt-1 block text-[10px] font-normal text-gray-500">{control.helpText}</span>}
    </label>
  );
};

export const ControlGroupConsole = ({
  group,
  values,
  busy,
  onChange,
}: {
  group: ControlGroup;
  values: ToolValues;
  busy: boolean;
  onChange: ControlChangeHandler;
}) => {
  const fields = (
    <div className="grid gap-2">
      {group.controls.map((control) => (
        <ControlField
          key={control.id}
          control={control}
          currentValue={values[control.id] ?? control.defaultValue ?? ''}
          busy={busy}
          onChange={onChange}
        />
      ))}
    </div>
  );

  if (group.advanced) {
    return (
      <details className="rounded border border-gray-200 bg-white p-2">
        <summary className="cursor-pointer font-mono text-[11px] font-semibold text-gray-700">{group.label}</summary>
        <div className="mt-3">{fields}</div>
      </details>
    );
  }

  return (
    <section className="rounded border border-gray-200 bg-white p-2">
      <h4 className="mb-2 font-mono text-[11px] font-semibold text-gray-800">{group.label}</h4>
      {fields}
    </section>
  );
};
