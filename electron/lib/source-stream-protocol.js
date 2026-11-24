'use strict';

const { protocol } = require('electron');

const SCHEME = 'anix-stream';

function getSourceOrigin(host) {
  if (host === 'tut-video.net' || host.endsWith('.tut-video.net')) return 'https://player.aksor.tv';
  if (host.endsWith('.userplay.live')) return 'https://alloha.yani.tv';
  if (host.endsWith('.okcdn.ru')) return 'https://player.cdnvideohub.com';
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
  return fetch(url, {
    ...options,
    headers: { Origin: origin, Referer: origin + '/', ...options.headers },
    redirect: 'error',
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

function setupSourceStreamProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      const url = new URL(request.url.replace(/^anix-stream:/, 'https:'));
      if (!sourceStreamUrl(url.href)) return new Response(null, { status: 403 });
      const headers = {};
      const range = request.headers.get('Range');
      if (range) headers.Range = range;
      const response = await fetchSourceStream(url, { headers, method: request.method, signal: AbortSignal.timeout(15000) });
      const out = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
      });
      for (const name of ['Content-Type', 'Content-Range', 'Accept-Ranges']) {
        const value = response.headers.get(name);
        if (value) out.set(name, value);
      }
      if (response.ok && request.method === 'GET' && url.pathname.endsWith('.m3u8')) {
        out.set('Content-Type', 'application/vnd.apple.mpegurl');
        return new Response(rewritePlaylist(await response.text(), url.href), { headers: out });
      }
      if (response.ok && request.method === 'GET'
        && (url.pathname.endsWith('.mpd') || out.get('Content-Type')?.includes('application/dash+xml'))) {
        out.set('Content-Type', 'application/dash+xml');
        const text = (await response.text()).replace(/https:\/\/([a-z0-9.-]+)(?=\/)/gi,
          (absolute, host) => getSourceOrigin(host.toLowerCase()) ? SCHEME + '://' + host : absolute);
        return new Response(text, { headers: out });
      }
      return new Response(response.body, { status: response.status, headers: out });
    } catch {
      return new Response(null, { status: 502 });
    }
  });
}

module.exports = { registerSourceStreamScheme, setupSourceStreamProtocol, sourceStreamUrl, fetchSourceStream };
