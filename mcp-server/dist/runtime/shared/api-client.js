import { BASE_URL, JSON_REQUEST_HEADERS, RAW_REQUEST_HEADERS } from './config.js';
export async function apiRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            ...JSON_REQUEST_HEADERS,
            ...options.headers,
        },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error (${response.status}): ${error}`);
    }
    return response.json();
}
export async function apiRequestRaw(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            ...RAW_REQUEST_HEADERS,
            ...options.headers,
        },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error (${response.status}): ${error}`);
    }
    return response;
}
