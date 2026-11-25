'use strict';

const { protocol } = require('electron');

const SCHEME = 'anix-stream';

const ANIME_LIB_UA = 'LibAppC/2.0.2 (Android 13; 2201116PG; POCO veux; ru) Complete/3066669';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function isAnimeLibMediaHost(host) {
  return host === 'cdnlibs.org' || host.endsWith('.cdnlibs.org') || host === 'imglib.info' || host.endsWith('.imglib.info');
}

function getSourceOrigin(host) {
  if (host === 'sameband.studio' || host === 'sb.sameband.studio') return 'https://' + host;
  if (host === 'video.animetop.info' || host === 'animevost.org' || host.endsWith('.animevost.org')) return 'https://animevost.org';
  if (host === 'tut-video.net' || host.endsWith('.tut-video.net')) return 'https://player.aksor.tv';
  if (host.endsWith('.userplay.live')) return 'https://alloha.yani.tv';
  if (host.endsWith('.okcdn.ru')) return 'https://player.cdnvideohub.com';
  if (isAnimeLibMediaHost(host)) return 'https://animelib.org';
  return null;
}

function sourceStreamUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !getSourceOrigin(url.hostname)) return null;
  return url.href.replace(/^https:/, SCHEME + ':');
}

function registerSourceStreamScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
  } }]);
}

function fetchSourceStream(raw, options = {}) {
  const url = new URL(raw);
  if (!sourceStreamUrl(url.href)) throw new Error('Unsupported source stream host');
  const origin = getSourceOrigin(url.hostname);
  const extraHeaders = isAnimeLibMediaHost(url.hostname)
    ? {
        Origin: 'animelib.org',
        Referer: 'animelib.org',
        'Site-Id': '5',
        'User-Agent': ANIME_LIB_UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Encoding': 'identity',
      }
    : {
        Origin: origin,
        Referer: origin + '/',
        ...(url.hostname.endsWith('.okcdn.ru') ? { 'User-Agent': BROWSER_UA } : {}),
      };
  return fetch(url, {
    ...options,
    headers: { ...extraHeaders, ...options.headers },
    redirect: isAnimeLibMediaHost(url.hostname) ? 'follow' : 'error',
  });
}

function rewritePlaylist(text, base) {
  const convert = (value) => {
    try { return sourceStreamUrl(new URL(value, base).href) || value; } catch { return value; }
  };
  return text.split(/\r?\n/).map((line) => {
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, url) => `URI="${convert(url)}"`);
    return line.trim() ? convert(line.trim()) : line;
  }).join('\n');
}

const STREAM_CONNECT_TIMEOUT_MS = 15000;

async function probeSourceStream(raw, manifest) {
  if (typeof raw !== 'string' || !raw.startsWith(SCHEME + '://')) return { status: 400 };
  const url = new URL(raw.replace(/^anix-stream:/, 'https:'));
  if (!sourceStreamUrl(url.href)) return { status: 403 };
  const response = await fetchSourceStream(url, {
    headers: manifest ? {} : { Range: 'bytes=0-31' },
    signal: AbortSignal.timeout(STREAM_CONNECT_TIMEOUT_MS),
  });
  const type = response.headers.get('Content-Type') ?? '';
  const result = { status: response.status, type, retryAfter: response.headers.get('Retry-After') };
  if (!manifest || !response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    return result;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) return { status: 413 };
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
  return { ...result, text: text.trimStart().startsWith('#EXTM3U') ? rewritePlaylist(text, url.href) : text };
}

function normalizeAcceptRanges(value) {
  if (!value) return 'bytes';
  return /\bbytes\b/i.test(value) ? 'bytes' : value;
}

function buildStreamResponseHeaders(upstreamHeaders, status) {
  const out = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  });
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = upstreamHeaders.get(name);
    if (value) out.set(name, name === 'Accept-Ranges' ? normalizeAcceptRanges(value) : value);
  }
  if (!out.has('Accept-Ranges') && (status === 206 || (status >= 200 && status < 300))) {
    out.set('Accept-Ranges', 'bytes');
  }
  return out;
}

function setupSourceStreamProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const controller = new AbortController();
    const connectTimer = setTimeout(
      () => controller.abort(new DOMException('Connect timeout', 'TimeoutError')),
      STREAM_CONNECT_TIMEOUT_MS,
    );
    const onAbort = () => controller.abort(request.signal?.reason);
    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(connectTimer);
        return new Response(null, { status: 499 });
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      const url = new URL(request.url.replace(/^anix-stream:/, 'https:'));
      if (!sourceStreamUrl(url.href)) return new Response(null, { status: 403 });
      const headers = {};
      const range = request.headers.get('Range');
      if (range) headers.Range = range;
      const response = await fetchSourceStream(url, { headers, method: request.method, signal: controller.signal });
      clearTimeout(connectTimer);
      const out = buildStreamResponseHeaders(response.headers, response.status);
      if (response.ok && request.method === 'GET' && url.pathname.endsWith('.m3u8')) {
        out.set('Content-Type', 'application/vnd.apple.mpegurl');
        out.delete('Content-Length');
        return new Response(rewritePlaylist(await response.text(), url.href), { headers: out });
      }
      if (response.ok && request.method === 'GET'
        && (url.pathname.endsWith('.mpd') || out.get('Content-Type')?.includes('application/dash+xml'))) {
        out.set('Content-Type', 'application/dash+xml');
        out.delete('Content-Length');
        const text = (await response.text()).replace(/https:\/\/([a-z0-9.-]+)(?=\/)/gi,
          (absolute, host) => getSourceOrigin(host.toLowerCase()) ? SCHEME + '://' + host : absolute);
        return new Response(text, { headers: out });
      }
      const body = request.method === 'HEAD' ? null : response.body;
      return new Response(body, { status: response.status, headers: out });
    } catch {
      return new Response(null, { status: 502 });
    } finally {
      clearTimeout(connectTimer);
    }
  });
}

module.exports = {
  registerSourceStreamScheme,
  setupSourceStreamProtocol,
  sourceStreamUrl,
  fetchSourceStream,
  probeSourceStream,
  buildStreamResponseHeaders,
};
