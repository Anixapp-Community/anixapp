'use strict';

const { fetchMediaProbe } = require('./media-proxy');

let customSources;

async function servesVideo(url, fetchStream = fetch) {
  try {
    const response = await fetchStream(url, {
      headers: { Range: 'bytes=0-31' },
      signal: AbortSignal.timeout(4500),
    });
    const type = response.headers.get('content-type') || '';
    await response.body?.cancel();
    return response.ok && /^(video\/|application\/octet-stream)/i.test(type);
  } catch {
    return false;
  }
}

async function resolveAnimeLibStream(url) {
  const { fetchSourceStream, sourceStreamUrl } = require('./source-stream-protocol');
  const { BACKUP_API_PROXY, getBackupProxyEnabled } = require('./backup-proxy');
  const host = new URL(url).hostname;
  if (!/(^|\.)(cdnlibs\.org|imglib\.info)$/.test(host)) return null;
  const direct = sourceStreamUrl(url);
  if (!direct) return null;
  if (await servesVideo(url, fetchSourceStream)) return direct;
  if (!getBackupProxyEnabled()) return null;
  const proxy = new URL('/tv/media', BACKUP_API_PROXY);
  proxy.searchParams.set('u', url);
  proxy.searchParams.set('ref', 'https://animelib.org/');
  return await servesVideo(proxy.href) ? proxy.href : null;
}

function getCustomSources() {
  const desktop = Boolean(process.versions.electron);
  customSources ??= import('./custom-sources.mjs').then(({ createCustomSources }) =>
    createCustomSources({
      fetchMedia: fetchMediaProbe,
      ...(desktop && {
        fetchMedia: require('./source-stream-protocol').fetchSourceStream,
        resolveAlloha: require('./alloha-playback').resolveAllohaStream,
        resolveAnimeLibStream,
        prepareStream: require('./source-stream-protocol').sourceStreamUrl,
      }),
      aniTypeToken: process.env.ANITYPE_ENABLED === 'true' ? process.env.ANITYPE_TOKEN?.trim() : '',
      aniLibToken: process.env.ANIMELIB_TOKEN?.trim() || process.env.MANGALIB_TOKEN?.trim() || '',
      animeLibVideoBaseUrl: process.env.ANIMELIB_VIDEO_BASE_URL?.trim() || undefined,
      animeLibVideoPathPrefix: process.env.ANIMELIB_VIDEO_PATH_PREFIX?.trim() || undefined,
    }));
  return customSources;
}

module.exports = { getCustomSources };
