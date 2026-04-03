const parseJson = async (response) => {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : null;
};

export const createLocalDemo = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/dev/demo`, {
    method: 'POST',
  });

  return parseJson(response);
};

export const fetchLocalDevStatus = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/dev/status`);
  return parseJson(response);
};

