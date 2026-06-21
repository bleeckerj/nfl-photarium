import { Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ImageToolManifest } from '@/services/imageToolsService';
import type { ToolValues } from '@/components/image-detail/image-tools/controlModel';
import {
  deleteSavedImageToolConfiguration,
  getSavedImageToolConfigurations,
  normalizeSavedToolValues,
  upsertSavedImageToolConfiguration,
  type SavedImageToolConfiguration,
} from '@/components/image-detail/image-tools/savedConfigurations';

type SavedConfigurationsPanelProps = {
  tool: ImageToolManifest;
  values: ToolValues;
  busy: boolean;
  onLoad: (values: ToolValues) => void;
};

export const SavedConfigurationsPanel = ({
  tool,
  values,
  busy,
  onLoad,
}: SavedConfigurationsPanelProps) => {
  const [configurations, setConfigurations] = useState<SavedImageToolConfiguration[]>([]);
  const [selectedConfigurationId, setSelectedConfigurationId] = useState('');
  const [configurationName, setConfigurationName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfigurations(getSavedImageToolConfigurations(tool.id));
    setSelectedConfigurationId('');
    setConfigurationName('');
    setMessage(null);
    setError(null);
  }, [tool.id]);

  const handleSelectConfiguration = (configurationId: string) => {
    setSelectedConfigurationId(configurationId);
    setMessage(null);
    setError(null);

    const configuration = configurations.find((item) => item.id === configurationId);
    if (!configuration) {
      setConfigurationName('');
      return;
    }

    setConfigurationName(configuration.name);
    onLoad(normalizeSavedToolValues(tool, configuration.values));
    setMessage(`Loaded ${configuration.name}`);
  };

  const handleSaveConfiguration = () => {
    setError(null);
    setMessage(null);
    try {
      const result = upsertSavedImageToolConfiguration({
        tool,
        name: configurationName,
        values,
        existingId: selectedConfigurationId || undefined,
      });
      setConfigurations(result.configurations);
      setSelectedConfigurationId(result.configuration.id);
      setConfigurationName(result.configuration.name);
      setMessage(`Saved ${result.configuration.name}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save configuration.');
    }
  };

  const handleDeleteConfiguration = () => {
    if (!selectedConfigurationId) return;
    try {
      setConfigurations(deleteSavedImageToolConfiguration(tool.id, selectedConfigurationId));
      setSelectedConfigurationId('');
      setConfigurationName('');
      setMessage('Deleted configuration');
      setError(null);
    } catch (deleteError) {
      setMessage(null);
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete configuration.');
    }
  };

  return (
    <section className="rounded border border-gray-200 bg-white p-2">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 pb-1 font-mono text-[11px] font-semibold text-gray-800">
        <span>Configurations</span>
        <span className="text-[10px] font-normal text-gray-500">{configurations.length} saved</span>
      </div>
      <div className="grid gap-2">
        <label className="block font-mono text-[11px] text-gray-600">
          Saved
          <select
            value={selectedConfigurationId}
            onChange={(event) => handleSelectConfiguration(event.target.value)}
            disabled={busy || configurations.length === 0}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 disabled:opacity-50"
          >
            <option value="">Select configuration</option>
            {configurations.map((configuration) => (
              <option key={configuration.id} value={configuration.id}>{configuration.name}</option>
            ))}
          </select>
        </label>
        <label className="block font-mono text-[11px] text-gray-600">
          Name
          <input
            type="text"
            value={configurationName}
            onChange={(event) => setConfigurationName(event.target.value)}
            disabled={busy}
            placeholder="Warm VHS scanlines"
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 disabled:opacity-50"
          />
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
          <button
            type="button"
            onClick={handleSaveConfiguration}
            disabled={busy || !configurationName.trim()}
            className="inline-flex items-center justify-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save configuration
          </button>
          <button
            type="button"
            onClick={handleDeleteConfiguration}
            disabled={busy || !selectedConfigurationId}
            title="Delete configuration"
            aria-label="Delete configuration"
            className="inline-flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {message && <p className="font-mono text-[10px] text-green-700">{message}</p>}
        {error && <p className="font-mono text-[10px] text-red-600">{error}</p>}
      </div>
    </section>
  );
};
