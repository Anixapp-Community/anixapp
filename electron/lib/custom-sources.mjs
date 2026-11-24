const SOURCE_BASE = 100_000_000;
const SOURCE_STRIDE = 10;
const cvhHost = 'ru.yummyani.me';
const providers = [
  ['Aksor', 'player.aksor.tv'],
  ['Alloha', 'alloha.yani.tv'],
  ['CVH', cvhHost],
];
const aniTypeHost = 'res.anitypeapis.ru';
const CACHE_MS = 5 * 60_000;

export function isCustomSourceId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= SOURCE_BASE + SOURCE_STRIDE;
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function translationName(value) {
  return String(value ?? '').trim().replace(/^озвучка(?:\s*[:|–-]\s*|\s+)/i, '');
}

function translationKey(value, subtitles = false) {
  const name = translationName(value);
  const sub = subtitles || /^(субтитры?|subs?)\b|^субтитр/i.test(name);
  const label = normalize(name.replace(/^(?:субтитры?|subs?)\s*[:|–-]?\s*/i, ''));
  return label ? `${sub ? 'sub' : 'voice'}:${label}` : '';
}

function secureUrl(value, hostname) {
  try {
    const url = new URL(String(value).replace(/^\/\//, 'https://'));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (!hostname || url.hostname === hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export function createCustomSources({
  fetcher = globalThis.fetch, fetchMedia = fetcher, aniTypeToken = '',
  resolveAlloha, prepareStream = (url) => url,
} = {}) {
  const cache = new Map();

  function cached(key, load, ttl = CACHE_MS) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.result;
    if (cache.size >= 48) cache.delete(cache.keys().next().value);
    const result = Promise.resolve().then(load).catch(() => {
      if (cache.get(key)?.result === result) cache.delete(key);
      return null;
    });
    cache.set(key, { expires: now + ttl, result });
    return result;
  }

  async function json(url, headers) {
    const response = await fetcher(url, {
      headers, redirect: 'error', signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error('Custom source unavailable');
    return response.json();
  }

  function catalog(release, releaseId) {
    return cached(`catalog:${releaseId}`, async () => {
      const response = await release.info(releaseId, true);
      const detail = response?.release ?? response;
      const title = detail?.title_original || detail?.title_ru;
      if (!title) return null;
      let shikiId = Number(detail.shikimori_id);
      if (!(shikiId > 0)) {
        const search = await json(`https://shikimori.io/api/animes?limit=10&search=${encodeURIComponent(title)}`);
        const matches = (Array.isArray(search) ? search : []).filter((item) =>
          [item.name, item.russian].some((name) => normalize(name) === normalize(title))
          && (!detail.year || String(item.aired_on ?? '').startsWith(String(detail.year))));
        if (matches.length !== 1) return null;
        shikiId = Number(matches[0].id);
      }
      if (!Number.isSafeInteger(shikiId) || shikiId <= 0) return null;
      return { shikiId, title: detail.title_ru || title };
    });
  }

  function yummyVideos({ shikiId, title }) {
    return cached(`yummy:${shikiId}`, async () => {
      const search = await json(`https://api.yani.tv/search?limit=20&offset=0&q=${encodeURIComponent(title)}`);
      const match = search.response?.find((item) => Number(item.remote_ids?.shikimori_id) === shikiId);
      const id = Number(match?.anime_id);
      if (!Number.isSafeInteger(id) || id <= 0) return [];
      const videos = await json(`https://api.yani.tv/anime/${id}/videos`);
      return Array.isArray(videos.response) ? videos.response : [];
    });
  }

  function yummyProvider(video) {
    const index = providers.findIndex(([name]) => normalize(name) ===
      normalize(String(video.data?.player ?? '').replace(/^плеер\s+/i, '')));
    if (index < 0) return null;
    const [name, host] = providers[index];
    if (host === 'alloha.yani.tv' && !resolveAlloha) return null;
    const url = secureUrl(video.iframe_url, host);
    return url ? { index, name, url } : null;
  }

  async function getDubbers(release, releaseId) {
    const official = await cached(`types:${releaseId}`, () => release.getDubbers(releaseId));
    const entry = await catalog(release, releaseId);
    const videos = entry ? await yummyVideos(entry) : [];
    const types = official?.types ?? [];
    const known = new Set(types.map((item) => translationKey(item.name, item.is_sub === true || item.isSub === true)));
    const external = new Map();
    for (const video of videos ?? []) {
      const name = translationName(video.data?.dubbing);
      const key = translationKey(name);
      if (!key || known.has(key) || !yummyProvider(video) || video.number == null || video.number === ''
        || !Number.isSafeInteger(Number(video.number)) || Number(video.number) < 0) continue;
      if (!external.has(key)) external.set(key, { name, positions: new Set() });
      external.get(key).positions.add(Number(video.number));
    }
    const used = new Set(types.map((type) => Number(type.id)));
    const additions = [...external].sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
      let hash = 2166136261;
      for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
      let id = 1_000_000_000 + (hash >>> 0) % 1_000_000_000;
      while (used.has(id)) id++;
      used.add(id);
      return { id, name: item.name, is_sub: key.startsWith('sub:'), is_external: true, episode_count: item.positions.size };
    });
    return additions.length ? { ...official, code: 0, types: [...types, ...additions] } : official;
  }

  async function getSources(release, releaseId, dubberId) {
    return cached(`sources:${releaseId}:${dubberId}`, async () => {
      const [entry, types] = await Promise.all([
        catalog(release, releaseId),
        getDubbers(release, releaseId),
      ]);
      const type = types?.types?.find((item) => Number(item.id) === dubberId);
      const dub = translationKey(type?.name, type?.is_sub === true || type?.isSub === true);
      if (!entry || !dub) return [];
      const { shikiId } = entry;
      const [videos, uhd] = await Promise.all([
        yummyVideos(entry),
        aniTypeToken ? cached(`anitype:${shikiId}`, () =>
          json(`https://${aniTypeHost}/videos/episodes/${shikiId}`)) : [],
      ]);
      const groups = new Map();
      function add(index, name, number, url, iframe) {
        const position = Number(number);
        if (!url || number == null || number === '' || !Number.isSafeInteger(position) || position < 0) return;
        const id = SOURCE_BASE + dubberId * SOURCE_STRIDE + index;
        const group = groups.get(id) ?? { id, name, episodes: new Map() };
        if (!group.episodes.has(position)) group.episodes.set(position, { position, name: `Серия ${position}`, url, iframe });
        groups.set(id, group);
      }
      for (const video of videos ?? []) {
        if (translationKey(video.data?.dubbing) !== dub) continue;
        const provider = yummyProvider(video);
        if (provider) add(provider.index, `${provider.name} (YummyAnime)`, video.number, provider.url, true);
      }
      for (const episode of Array.isArray(uhd) ? uhd : []) {
        if (!episode.translation?.has_uhd || translationKey(episode.translation.title) !== dub) continue;
        const url = `https://${aniTypeHost}/kodik/additional/${shikiId}/${encodeURIComponent(episode.episode)}?translation=${encodeURIComponent(episode.translation.title)}`;
        add(3, 'AniType (4K)', episode.episode, url, false);
      }
      return [...groups.values()];
    }).then((sources) => sources ?? []);
  }

  async function getSource(release, releaseId, sourceId) {
    const dubberId = Math.floor((sourceId - SOURCE_BASE) / SOURCE_STRIDE);
    if (dubberId <= 0) return null;
    return (await getSources(release, releaseId, dubberId)).find((item) => item.id === sourceId) ?? null;
  }

  async function resolveCvh(url) {
    const params = new URL(url).searchParams;
    const id = params.get('anime_id');
    const position = params.get('episode');
    const dub = params.get('dubbing_code')?.replace(/\+/g, ' ');
    if (!id || !position || !dub) return null;
    const api = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
    const playlist = await cached(`cvh:${id}`, () =>
      json(`${api}/playlist?pub=1&aggr=mali&id=${encodeURIComponent(id)}`));
    const item = playlist?.items?.find((entry) => String(entry.episode) === position && entry.voiceStudio === dub);
    if (!item?.vkId) return null;
    const video = await json(`${api}/video/${encodeURIComponent(item.vkId)}`);
    for (const [candidate, format] of [
      [video.sources?.dashUrl, 'dash'],
      [video.sources?.hlsUrl, 'hls'],
      [video.sources?.mpegFullHdUrl, 'mp4'],
      [video.sources?.mpegHighUrl, 'mp4'],
    ]) {
      const url = secureUrl(candidate);
      if (!url || !/(^|\.)okcdn\.ru$/.test(new URL(url).hostname)) continue;
      try {
        const response = await fetchMedia(url, {
          headers: format === 'mp4' ? { Range: 'bytes=0-1023' } : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(2500),
        });
        if (format !== 'mp4' && response.ok) {
          const body = (await response.text()).trimStart();
          if (format === 'hls' && body.startsWith('#EXTM3U')) return url;
          if (format === 'dash' && /<MPD[\s>]/.test(body)) return url + '#dash.mpd';
        } else {
          void response.body?.cancel().catch(() => {});
          if (response.ok && /^video\//i.test(response.headers.get('content-type') ?? '')) return url;
        }
      } catch {
        // A broken signed stream should not prevent using the provider's embed.
      }
    }
    return null;
  }

  async function resolveEpisode(episode) {
    if (!episode) return null;
    if (episode.iframe) {
      try {
        const embed = new URL(episode.url);
        let url;
        if (embed.hostname === cvhHost) url = await resolveCvh(embed.href);
        if (embed.hostname === 'alloha.yani.tv' && resolveAlloha) {
          url = await cached(`alloha:${embed.href}`, () => resolveAlloha(embed.href), 20_000);
        }
        if (embed.hostname === 'player.aksor.tv') {
          const id = /^\/video\/([a-f0-9]+)\/?$/i.exec(embed.pathname)?.[1];
          if (!id) return null;
          const data = await json(`https://player.aksor.tv/api/video/${id}`);
          const qualityMap = {};
          for (const [key, height] of Object.entries({ q4k: 2160, q2k: 1440, q1080: 1080, q720: 720, q480: 480, q360: 360 })) {
            const candidate = secureUrl(data.qualities?.[key]);
            if (!candidate || !/(^|\.)tut-video\.net$/.test(new URL(candidate).hostname)) continue;
            const stream = prepareStream(candidate);
            if (stream) qualityMap[height] = stream;
          }
          const currentQuality = Object.keys(qualityMap).at(-1);
          return currentQuality ? { ...episode, url: qualityMap[currentQuality], iframe: false, qualityMap, currentQuality } : null;
        }
        const playable = url && prepareStream(url);
        return playable ? { ...episode, url: playable, iframe: false } : null;
      } catch {
        return null;
      }
    }
    try {
      const payload = await json(episode.url, { authorization: `Bearer ${aniTypeToken}` });
      const qualityMap = {};
      for (const item of Array.isArray(payload) ? payload : []) {
        const height = Number(item.quality);
        const url = secureUrl(item.src);
        if (Number.isInteger(height) && height > 0 && url) qualityMap[height] = url;
      }
      const currentQuality = qualityMap['2160'] ? '2160' : Object.keys(qualityMap).at(-1);
      return currentQuality ? { ...episode, url: qualityMap[currentQuality], qualityMap, currentQuality } : null;
    } catch {
      return null;
    }
  }

  return {
    getDubbers,
    async getDubberSources(release, releaseId, dubberId) {
      const [official, custom] = await Promise.allSettled([
        dubberId >= 1_000_000_000 ? Promise.resolve({ sources: [] }) : release.getDubberSources(releaseId, dubberId),
        getSources(release, releaseId, dubberId),
      ]);
      const extra = custom.status === 'fulfilled' ? custom.value : [];
      if (!extra.length) {
        if (official.status === 'rejected') throw official.reason;
        return official.value;
      }
      const baseline = official.status === 'fulfilled' ? official.value : null;
      return {
        ...baseline,
        code: 0,
        sources: [...(baseline?.sources ?? []), ...extra.map(({ id, name, episodes }) =>
          ({ id, name, episodes_count: episodes.size }))],
      };
    },

    async getEpisodes(release, releaseId, dubberId, sourceId, sort = 1) {
      if (sourceId < SOURCE_BASE) return release.getEpisodes(releaseId, dubberId, sourceId, sort);
      const source = await getSource(release, releaseId, sourceId);
      const episodes = [...(source?.episodes.values() ?? [])].sort((a, b) =>
        sort === 2 ? b.position - a.position : a.position - b.position);
      return { code: 0, episodes: episodes.map((ep) => ({ ...ep, url: '', iframe: false })) };
    },

    async getEpisode(release, releaseId, sourceId, position) {
      if (sourceId < SOURCE_BASE) return release.getEpisode(releaseId, sourceId, position);
      const source = await getSource(release, releaseId, sourceId);
      return { code: 0, episode: await resolveEpisode(source?.episodes.get(Number(position))) ?? null };
    },
  };
}
