import { createEffectsApi, type EffectsApi } from 'nfl-grainrad-clone';

let apiSingleton: EffectsApi | null = null;

export const getGrainradApi = (): EffectsApi => {
  if (!apiSingleton) apiSingleton = createEffectsApi();
  return apiSingleton;
};
