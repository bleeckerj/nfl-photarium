export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

export const DEFAULT_OPENAI_IMAGE_METADATA_MODEL = 'gpt-4.1-nano';

const getEnvModel = (name: string) => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const resolveModel = (envNames: string[], fallback = DEFAULT_OPENAI_IMAGE_METADATA_MODEL) =>
  envNames.map(getEnvModel).find(Boolean) ?? fallback;

export const getOpenAiAltModel = () =>
  resolveModel(['OPENAI_ALT_MODEL', 'OPENAI_IMAGE_METADATA_MODEL']);

export const getOpenAiDescriptionModel = () =>
  resolveModel(['OPENAI_DESCRIPTION_MODEL', 'OPENAI_IMAGE_METADATA_MODEL']);

export const getOpenAiDisplayNameModel = () =>
  resolveModel(['OPENAI_DISPLAY_NAME_MODEL', 'OPENAI_IMAGE_METADATA_MODEL']);

export const getOpenAiPromptThisModel = () =>
  resolveModel(['OPENAI_PROMPT_MODEL', 'OPENAI_IMAGE_METADATA_MODEL']);

export const getOpenAiTagsModel = () =>
  resolveModel(['OPENAI_TAGS_MODEL', 'OPENAI_DISPLAY_NAME_MODEL', 'OPENAI_IMAGE_METADATA_MODEL']);

export const getOpenAiHaikuModel = () =>
  resolveModel(['OPENAI_HAIKU_MODEL', 'OPENAI_IMAGE_METADATA_MODEL']);
