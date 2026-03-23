import { createHmac, randomUUID } from 'node:crypto';
import { percentEncode } from './util.mjs';
import {
  FLICKR_ACCESS_TOKEN_URL,
  FLICKR_AUTHORIZE_URL,
  FLICKR_REQUEST_TOKEN_URL,
} from './constants.mjs';

function normalizePairs(pairs) {
  return pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [percentEncode(key), percentEncode(value)])
    .sort(([keyA, valueA], [keyB, valueB]) => (keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB)))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function buildSignature({ method, baseUrl, queryParams, oauthParams, bodyParams, consumerSecret, tokenSecret }) {
  const pairs = [
    ...Object.entries(queryParams || {}),
    ...Object.entries(oauthParams || {}),
    ...Object.entries(bodyParams || {}),
  ];
  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalizePairs(pairs)),
  ].join('&');
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`;
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthorizationHeader(oauthParams) {
  const header = Object.entries(oauthParams)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

function buildOAuthParams({ consumerKey, token, extra = {} }) {
  return {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: `${Math.floor(Date.now() / 1000)}`,
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extra,
  };
}

async function signedRequest({
  url,
  method = 'GET',
  queryParams = {},
  bodyParams = {},
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  oauthExtra,
}) {
  const oauthParams = buildOAuthParams({
    consumerKey,
    token,
    extra: oauthExtra,
  });
  const signature = buildSignature({
    method,
    baseUrl: url,
    queryParams,
    oauthParams,
    bodyParams: method === 'POST' ? bodyParams : {},
    consumerSecret,
    tokenSecret,
  });
  const authHeader = buildAuthorizationHeader({
    ...oauthParams,
    oauth_signature: signature,
  });

  const finalUrl = new URL(url);
  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      finalUrl.searchParams.set(key, String(value));
    }
  });

  const headers = {
    Authorization: authHeader,
  };

  const init = {
    method,
    headers,
  };

  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(bodyParams).toString();
  }

  return fetch(finalUrl, init);
}

function parseQueryBody(text) {
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

export async function requestToken({ apiKey, apiSecret }) {
  const response = await signedRequest({
    url: FLICKR_REQUEST_TOKEN_URL,
    method: 'POST',
    consumerKey: apiKey,
    consumerSecret: apiSecret,
    oauthExtra: {
      oauth_callback: 'oob',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Flickr request token failed (${response.status})`);
  }
  const payload = parseQueryBody(text);
  if (!payload.oauth_token || !payload.oauth_token_secret) {
    throw new Error('Flickr request token response was incomplete.');
  }
  return payload;
}

export function buildAuthorizeUrl(oauthToken) {
  const url = new URL(FLICKR_AUTHORIZE_URL);
  url.searchParams.set('oauth_token', oauthToken);
  url.searchParams.set('perms', 'read');
  return url.toString();
}

export async function accessToken({ apiKey, apiSecret, requestTokenValue, requestTokenSecret, verifier }) {
  const response = await signedRequest({
    url: FLICKR_ACCESS_TOKEN_URL,
    method: 'POST',
    consumerKey: apiKey,
    consumerSecret: apiSecret,
    token: requestTokenValue,
    tokenSecret: requestTokenSecret,
    oauthExtra: {
      oauth_verifier: verifier,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Flickr access token failed (${response.status})`);
  }
  const payload = parseQueryBody(text);
  if (!payload.oauth_token || !payload.oauth_token_secret) {
    throw new Error('Flickr access token response was incomplete.');
  }
  return payload;
}

export async function signedFlickrRestCall({
  apiKey,
  apiSecret,
  accessToken: token,
  accessTokenSecret: tokenSecret,
  method,
  params = {},
}) {
  const response = await signedRequest({
    url: 'https://www.flickr.com/services/rest',
    method: 'GET',
    consumerKey: apiKey,
    consumerSecret: apiSecret,
    token,
    tokenSecret,
    queryParams: {
      method,
      format: 'json',
      nojsoncallback: '1',
      ...params,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Flickr REST request failed (${response.status}) for ${method}`);
  }
  if (!payload || payload.stat !== 'ok') {
    throw new Error(payload?.message || `Flickr API error for ${method}`);
  }
  return payload;
}

