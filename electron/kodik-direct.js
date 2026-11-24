/**
 * Kodik / aniqit direct link resolution (Node fetch — для web-bridge и dev).
 */
const { parseKodikSkipButton } = require('./lib/skip-marks');

const KODIK_PLAYER_ORIGIN = 'https://kodikplayer.com/';
/** Уже расшифрованный URL — не трогаем (solodcdn /s/m/, useruploads, cloud и т.п.). */
const KODIK_PLAIN_SRC = /(?:kodik-storage|solodcdn)\.com\//i;
const { BACKUP_API_PROXY, getBackupProxyEnabled } = require('./lib/backup-proxy');
const { isAllowedMediaUrl } = require('./lib/media-proxy');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalizeKodikEmbedUrl(embedUrl) {
  return embedUrl.startsWith('http') ? embedUrl : `https:${embedUrl}`;
}

function decryptKodikSrc(src) {
  const zCharCode = 'Z'.charCodeAt(0);
  const decryptedBase64 = src.replace(/[a-zA-Z]/g, (e) => {
    let eCharCode = e.charCodeAt(0);
    return String.fromCharCode(
      (eCharCode <= zCharCode ? 90 : 122) >= (eCharCode = eCharCode + 18) ? eCharCode : eCharCode - 26,
    );
  });
  return Buffer.from(decryptedBase64, 'base64').toString('utf8');
}

function parseKodikLinkFromUrl(pageUrl) {
  const m = pageUrl.match(/\/(seria|video|movie|anime)\/(\d+)\/([0-9a-f]+)\//i);
  if (!m) return null;
  return { type: m[1], id: m[2], hash: m[3] };
}

function parseKodikEmbedHtml(html) {
  const hash = html.match(/\w+\.hash\s=\s'([^']+)';/is)?.[1];
  const id = html.match(/\w+\.id\s=\s'([^']+)';/is)?.[1];
  const type = html.match(/\w+\.type\s=\s'([^']+)';/is)?.[1];
  return { hash, id, type };
}

function decryptKodikLinks(links) {
  if (!links || typeof links !== 'object') return null;
  for (const [, sources] of Object.entries(links)) {
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      if (!source?.src || KODIK_PLAIN_SRC.test(source.src) || /^https?:\/\//i.test(source.src) || source.src.startsWith('//')) {
        continue;
      }
      try {
        source.src = decryptKodikSrc(source.src);
      } catch {
        /* ignore */
      }
    }
  }
  return links;
}

/** Kodik CDN: progressive MP4 (в т.ч. /f/) 302 на shadow.*, который часто недоступен.
 *  Оставляем/форсируем HLS для любого solodcdn / zerocdn / kodik-storage. */
function preferPlayableKodikUrl(url) {
  if (!url) return url;
  const abs = url.startsWith('http') ? url : url.startsWith('//') ? `https:${url}` : url;
  if (/:hls:/i.test(abs)) return abs;
  try {
    const parsed = new URL(abs);
    if (/solodcdn|kodik-storage|zerocdn|animedia|kodik-cdn/i.test(parsed.hostname)
      && /\.mp4$/i.test(parsed.pathname)) {
      parsed.pathname += ':hls:manifest.m3u8';
      return parsed.href;
    }
  } catch { /* keep */ }
  return abs;
}

function isKodikEdgeHost(host) {
  const h = String(host || '').toLowerCase();
  return /^(bingo|shadow)\.cloud\.solodcdn\.com$/i.test(h);
}

function isKodikManifest(url) {
  return /:hls:(manifest|hls)\.m3u8/i.test(url) || /\.m3u8(\?|$)/i.test(url);
}

/** CDN Kodik часто 302 на bingo/shadow.* — с части сетей edge недоступен. */
async function probeKodikMedia(manifestUrl, headers = {}, cancellation) {
  const baseHeaders = {
    Referer: 'https://kodikplayer.com/',
    'User-Agent': BROWSER_UA,
    Accept: '*/*',
    ...headers,
  };
  const deadline = AbortSignal.timeout(8_000);
  let current = manifestUrl;
  for (let hop = 0; hop < 4; hop++) {
    const timeoutMs = isKodikEdgeHost((() => {
      try { return new URL(current).hostname; } catch { return ''; }
    })()) ? 4_000 : 6_000;
    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: baseHeaders,
        signal: AbortSignal.any([deadline, AbortSignal.timeout(timeoutMs), ...(cancellation ? [cancellation] : [])]),
      });
    } catch {
      return false;
    }
    if (res.status >= 200 && res.status < 300) {
      const mime = res.headers.get('content-type') || '';
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return /mpegurl|^video\//i.test(mime) || (isKodikManifest(current) && !/text\/html|application\/json/i.test(mime));
    }
    const loc = res.headers.get('location');
    try { await res.body?.cancel(); } catch { /* ignore */ }
    if (!loc || ![301, 302, 303, 307, 308].includes(res.status)) return false;
    try { current = new URL(loc, current).href; } catch { return false; }
  }
  return false;
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchKodikFtorLinks(pageUrl, videoInfo) {
  const { type, hash, id } = videoInfo;
  if (!type || !hash || !id) return null;

  const ftorUrl = `https://kodikplayer.com/ftor?${new URLSearchParams({ type, hash, id }).toString()}`;
  const res = await fetch(ftorUrl, {
    headers: { Referer: pageUrl, Accept: 'application/json', 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  if (!payload?.links || typeof payload.links !== 'object') return null;
  return decryptKodikLinks(payload.links);
}

async function resolveKodikEmbedUrl(embedUrl) {
  let url = normalizeKodikEmbedUrl(embedUrl);
  const host = (url.match(/https?:\/\/([^/]+)/) || [])[1] || '';
  if (host.includes('kodik')) return url;

  if (host.includes('aniqit') || host.includes('anixis') || host.includes('aniqart')) {
    const html = await fetchText(url, {
      Referer: KODIK_PLAYER_ORIGIN,
      Accept: 'text/html,application/xhtml+xml',
    });
    const m = html.match(/https?:\\\/\\\/(?:[^\\/]+\.)?kodikplayer\.com\\\/seria\\\/[^"']+/i)
      ?? html.match(/(?:https:)?\/\/[^"'\s]*kodikplayer\.com\/seria\/[^"'\s]+/i);
    if (m) {
      let kodikUrl = m[0].replace(/\\/g, '');
      if (kodikUrl.startsWith('//')) kodikUrl = `https:${kodikUrl}`;
      return normalizeKodikEmbedUrl(kodikUrl);
    }
  }
  return url;
}

async function loadKodikPlayer(embedUrl) {
  const pageUrl = await resolveKodikEmbedUrl(embedUrl);
  let videoInfo = parseKodikLinkFromUrl(pageUrl);
  const htmlPromise = fetchText(pageUrl, {
    Referer: KODIK_PLAYER_ORIGIN,
    Accept: 'text/html,application/xhtml+xml',
  }).catch(() => '');
  const ftorEarly = (videoInfo?.hash && videoInfo?.id && videoInfo?.type)
    ? fetchKodikFtorLinks(pageUrl, videoInfo).catch(() => null)
    : Promise.resolve(null);

  const html = await htmlPromise;
  const skip = parseKodikSkipButton(html);
  if (!videoInfo?.hash || !videoInfo?.id || !videoInfo?.type) {
    videoInfo = parseKodikEmbedHtml(html);
  }
  let links = await ftorEarly;
  if (!links) {
    try {
      links = await fetchKodikFtorLinks(pageUrl, videoInfo || {});
    } catch {
      links = null;
    }
  }
  return { links, skip };
}

async function getKodikDirectLinks(embedUrl) {
  const { links } = await loadKodikPlayer(embedUrl);
  return links;
}

async function getDirectVideoLink(embedUrl) {
  const EMPTY = { directUrl: null, quality: null, qualityMap: {}, skip: null };
  if (!embedUrl || typeof embedUrl !== 'string') return EMPTY;

  const url = embedUrl.startsWith('http') ? embedUrl : `https:${embedUrl}`;
  const host = (url.match(/https?:\/\/([^/]+)/) || [])[1] || '';
  const toAbs = (src) => (!src ? null : src.startsWith('http') ? src : `https:${src}`);
  const PRIO = ['1080', '1080p', '720', '720p', '480', '480p', '360', '360p'];

  try {
    if (host.includes('kodik') || host.includes('aniqit') || host.includes('anixis') || host.includes('aniqart')) {
      const { links, skip } = await loadKodikPlayer(url);
      if (!links || typeof links !== 'object') return { ...EMPTY, skip: skip || null };
      const candidates = new Map();
      const qualityMap = {};
      for (const [key, variants] of Object.entries(links)) {
        const quality = key.replace(/p$/i, '');
        if (!Array.isArray(variants)) continue;
        for (const variant of variants) {
          const src = toAbs(variant?.src);
          if (!src) continue;
          const mediaUrl = preferPlayableKodikUrl(src);
          if (!candidates.has(mediaUrl)) candidates.set(mediaUrl, quality);
          qualityMap[quality] ??= mediaUrl;
        }
      }
      let best = PRIO.find((key) => qualityMap[key]) || Object.keys(qualityMap)[0];
      let directUrl = best ? qualityMap[best] : null;
      const dlHeaders = { Referer: 'https://kodikplayer.com/', 'User-Agent': BROWSER_UA };

      if (directUrl && !await probeKodikMedia(directUrl, dlHeaders)) {
        const unavailableUrl = directUrl;
        const alternates = [...candidates].filter(([url]) => url !== unavailableUrl).slice(0, 8);
        const cancelProbes = new AbortController();
        directUrl = await Promise.any(alternates.map(async ([url, quality]) => {
          if (!await probeKodikMedia(url, dlHeaders, cancelProbes.signal)) throw new Error('CDN candidate unavailable');
          return { url, quality };
        })).then((candidate) => {
          best = candidate.quality;
          // Other candidates are unverified on this network after the preferred CDN failed.
          for (const quality of Object.keys(qualityMap)) delete qualityMap[quality];
          qualityMap[best] = candidate.url;
          return candidate.url;
        }, () => null).finally(() => cancelProbes.abort());

        if (!directUrl && getBackupProxyEnabled() && isAllowedMediaUrl(unavailableUrl)) {
          const proxy = new URL('/tv/media', BACKUP_API_PROXY);
          proxy.searchParams.set('u', unavailableUrl);
          proxy.searchParams.set('ref', dlHeaders.Referer);
          if (await probeKodikMedia(proxy.href, dlHeaders)) {
            for (const quality of Object.keys(qualityMap)) delete qualityMap[quality];
            qualityMap[best] = proxy.href;
            directUrl = proxy.href;
          }
        }
        if (!directUrl) console.warn('[kodik-direct] CDN candidates unreachable, fallback to embed iframe');
      }

      return {
        directUrl,
        quality: directUrl ? best : null,
        qualityMap: directUrl ? qualityMap : {},
        skip: skip || null,
        downloadHeaders: directUrl ? dlHeaders : {},
      };
    }
  } catch (e) {
    console.error('[kodik-direct]', e?.message || e);
  }

  return EMPTY;
}

module.exports = { getDirectVideoLink, getKodikDirectLinks };
