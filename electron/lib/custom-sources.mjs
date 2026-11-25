const SOURCE_BASE = 100_000_000;
const SOURCE_STRIDE = 10;
const cvhHost = 'ru.yummyani.me';
const providers = [
  ['Aksor', 'player.aksor.tv'],
  ['Alloha', 'alloha.yani.tv'],
  ['CVH', cvhHost],
];
const aniTypeHost = 'res.anitypeapis.ru';
const animeLibApiOrigin = 'https://api.cdnlibs.org';
const animeLibFallbackOrigin = 'https://api.imglib.info';
const ANIME_LIB_INDEX = 4;
const ANIME_LIB_NAME = 'AnimeLib';
const ANIME_LIB_UA = 'LibAppC/2.0.2 (Android 13; 2201116PG; POCO veux; ru) Complete/3066669';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DEFAULT_ANIMELIB_VIDEO_BASE = 'https://video1.cdnlibs.org';
const DEFAULT_ANIMELIB_VIDEO_PREFIX = '/.%D0%B0s';
const ANIME_LIB_BATCH_SIZE = 6;
const ANIME_LIB_EAGER_LIMIT = 24;
const CACHE_MS = 5 * 60_000;

export function isCustomSourceId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= SOURCE_BASE + SOURCE_STRIDE;
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const TEAM_ALIASES = {
  anilibria: 'aniliberty',
  anilibriatv: 'aniliberty',
  anilibertyanilibria: 'aniliberty',
  aniliberty: 'aniliberty',
};

function translationName(value) {
  return String(value ?? '').trim().replace(/^озвучка(?:\s*[:|–-]\s*|\s+)/i, '');
}

function translationKey(value, subtitles = false) {
  const raw = translationName(value);
  const sub = subtitles || /^(субтитры?|subs?)\b|^субтитр|[|.(]\s*(?:субтитры?|subtitles?|subs?)\s*[)]?$/i.test(raw);
  const stripped = raw
    .replace(/^(?:субтитры?|subs?)\s*[:|–-]?\s*/i, '')
    .replace(/[|.]\s*(?:субтитры?|subtitles?|subs?)\s*$/i, '')
    .replace(/\s*\((?:субтитры?|subtitles?|subs?|anilibria|aniliberty)\)\s*$/i, '')
    .replace(/^то\s+/i, '')
    .replace(/\.tv$/i, '')
    .trim();
  const norm = normalize(stripped);
  if (!norm) return '';
  const label = TEAM_ALIASES[norm] ?? norm;
  return `${sub ? 'sub' : 'voice'}:${label}`;
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
  aniLibToken = '', animeLibVideoBaseUrl = DEFAULT_ANIMELIB_VIDEO_BASE,
  animeLibVideoPathPrefix = DEFAULT_ANIMELIB_VIDEO_PREFIX,
  resolveAlloha, resolveAnimeLibStream, prepareStream = (url) => url,
} = {}) {
  const cache = new Map();
  const videoBase = String(animeLibVideoBaseUrl || DEFAULT_ANIMELIB_VIDEO_BASE).replace(/\/+$/, '');
  const videoPrefix = String(animeLibVideoPathPrefix || DEFAULT_ANIMELIB_VIDEO_PREFIX).replace(/\/+$/, '');

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

  async function json(url, headers, timeoutMs = 4500) {
    const response = await fetcher(url, {
      headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('Custom source unavailable');
    return response.json();
  }

  function animeLibHeaders(useToken = false) {
    const headers = {
      Accept: '*/*;q=0.8',
      'Site-Id': '5',
      Origin: 'animelib.org',
      Referer: 'animelib.org',
      'User-Agent': ANIME_LIB_UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Encoding': 'identity',
    };
    if (useToken && aniLibToken) headers.Authorization = `Bearer ${aniLibToken}`;
    return headers;
  }

  let stickyAnimeLibOrigin = animeLibApiOrigin;

  async function animeLibJson(path, params = {}, { useToken = false, anonymousFallback = true } = {}) {
    const origins = stickyAnimeLibOrigin === animeLibFallbackOrigin
      ? [animeLibFallbackOrigin, animeLibApiOrigin]
      : [animeLibApiOrigin, animeLibFallbackOrigin];
    let lastErr;
    for (const origin of origins) {
      const url = new URL(path, origin);
      for (const [key, rawValue] of Object.entries(params)) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const value of values) url.searchParams.append(key, String(value));
      }
      try {
        let response = await fetcher(url.toString(), {
          headers: animeLibHeaders(useToken),
          redirect: 'error',
          signal: AbortSignal.timeout(4000),
        });
        if ((response.status === 401 || response.status === 403) && anonymousFallback && useToken && aniLibToken) {
          response = await fetcher(url.toString(), {
            headers: animeLibHeaders(false),
            redirect: 'error',
            signal: AbortSignal.timeout(4000),
          });
        }
        if (response.ok) {
          stickyAnimeLibOrigin = origin;
          return response.json();
        }
        if (response.status === 404) throw new Error('AnimeLib not found');
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        lastErr = new Error(`AnimeLib HTTP ${response.status}`);
      } catch (err) {
        lastErr = err;
        if (err?.message === 'AnimeLib not found') throw err;
      }
    }
    throw lastErr ?? new Error('AnimeLib unavailable');
  }

  function buildAnimeLibVideoUrl(href) {
    const clean = String(href ?? '').trim();
    if (!clean) return null;
    if (/^https?:\/\//i.test(clean)) return secureUrl(clean);
    const path = clean.startsWith('/') ? clean : `/${clean}`;
    return secureUrl(`${videoBase}${videoPrefix}${path}`);
  }

  function animeLibTeamInfo(player) {
    const rawTeam = String(player?.team?.name ?? '').trim();
    const transLabel = String(player?.translation_type?.label ?? '').trim();
    const isSub = /субтитр|subtitles?/i.test(transLabel) || /[|.(]\s*(?:субтитры?|subtitles?|subs?)\s*[)]?$/i.test(rawTeam);
    const displayName = translationName(
      rawTeam
        .replace(/[|.]\s*(?:субтитры?|subtitles?|subs?)\s*$/i, '')
        .replace(/\s*\((?:субтитры?|subtitles?|subs?)\)\s*$/i, '')
        .trim(),
    );
    const key = translationKey(rawTeam, isSub);
    return { name: displayName || rawTeam, isSub, key };
  }

  function releaseDetail(release, releaseId) {
    return cached(`release:${releaseId}`, async () => {
      const response = await release.info(releaseId, true);
      const detail = response?.release ?? response;
      const titleOrig = String(detail?.title_original ?? '').trim();
      const titleRu = String(detail?.title_ru ?? '').trim();
      const title = titleOrig || titleRu;
      if (!title) return null;
      return {
        title,
        titleOrig,
        titleRu: titleRu || title,
        year: detail?.year ? Number(detail.year) : null,
        shikiId: Number(detail?.shikimori_id) || 0,
      };
    });
  }

  function catalog(release, releaseId) {
    return cached(`catalog:${releaseId}`, async () => {
      const detail = await releaseDetail(release, releaseId);
      if (!detail) return null;
      let shikiId = detail.shikiId;
      if (!(shikiId > 0)) {
        const search = await json(`https://shikimori.io/api/animes?limit=10&search=${encodeURIComponent(detail.title)}`);
        const matches = (Array.isArray(search) ? search : []).filter((item) =>
          [item.name, item.russian].some((name) => normalize(name) === normalize(detail.title))
          && (!detail.year || String(item.aired_on ?? '').startsWith(String(detail.year))));
        if (matches.length !== 1) return null;
        shikiId = Number(matches[0].id);
      }
      if (!Number.isSafeInteger(shikiId) || shikiId <= 0) return null;
      return { shikiId, title: detail.titleRu };
    });
  }

  function shortTitleQuery(value) {
    const clean = String(value ?? '').trim();
    if (!clean) return '';
    const beforeSep = clean.split(/[:|(]/)[0].trim();
    if (beforeSep.length >= 4 && beforeSep.length < clean.length) return beforeSep;
    const words = clean.split(/\s+/);
    return words.length > 5 ? words.slice(0, 4).join(' ') : '';
  }

  async function findAnimeLibTitle(detail) {
    if (!detail) return null;
    const primaryQueries = [
      shortTitleQuery(detail.titleOrig) || detail.titleOrig,
      shortTitleQuery(detail.titleRu) || detail.titleRu,
    ].filter((q, idx, arr) => q && arr.indexOf(q) === idx);

    const candidates = new Map();
    const settled = await Promise.allSettled(
      primaryQueries.map((query) => animeLibJson('/api/anime', {
        'site_id[]': ['5'],
        'fields[]': ['rate', 'rate_avg', 'userBookmark'],
        q: query,
        page: '1',
      })),
    );
    let anyFulfilled = false;
    for (const res of settled) {
      if (res.status !== 'fulfilled') continue;
      anyFulfilled = true;
      for (const item of Array.isArray(res.value?.data) ? res.value.data : []) {
        if (item?.id && !candidates.has(item.id)) candidates.set(item.id, item);
      }
    }
    if (!anyFulfilled) throw new Error('AnimeLib search failed');
    if (candidates.size === 0) return null;

    const targetOrig = normalize(detail.titleOrig);
    const targetRu = normalize(detail.titleRu);
    const spinoffRe = /(?:mini\s*anime|мини[- ]?аниме|\bova\b|\bona\b|special|спешл|recap|рекап)/i;
    const targetIsSpinoff = spinoffRe.test(`${detail.titleOrig} ${detail.titleRu}`);
    let best = null;
    let bestScore = 0;

    for (const item of candidates.values()) {
      const rawNames = [item.rus_name, item.name, item.eng_name, ...(Array.isArray(item.otherNames) ? item.otherNames : [])];
      const names = rawNames.map(normalize).filter(Boolean);
      let score = 0;
      for (const candidateName of names) {
        if ((targetOrig && candidateName === targetOrig) || (targetRu && candidateName === targetRu)) {
          score = Math.max(score, 100);
        } else if (
          (targetOrig.length >= 4 && (candidateName.includes(targetOrig) || targetOrig.includes(candidateName)))
          || (targetRu.length >= 4 && (candidateName.includes(targetRu) || targetRu.includes(candidateName)))
        ) {
          score = Math.max(score, 60);
        }
      }
      if (score === 0) continue;
      if (!targetIsSpinoff && spinoffRe.test(rawNames.filter(Boolean).join(' '))) {
        score -= 50;
      }
      const dateStr = String(item.releaseDateString ?? item.releaseDate ?? '');
      if (detail.year && dateStr.includes(String(detail.year))) score += 20;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  function selectSampleEpisodes(episodes) {
    if (episodes.length <= ANIME_LIB_EAGER_LIMIT) return episodes;
    const picked = new Map();
    const addIdx = (idx) => {
      const ep = episodes[idx];
      if (ep?.epId) picked.set(ep.epId, ep);
    };
    for (let i = 0; i < 6; i += 1) addIdx(i);
    const mid = Math.floor(episodes.length / 2);
    for (let i = mid - 1; i <= mid + 1; i += 1) addIdx(i);
    for (let i = episodes.length - 3; i < episodes.length; i += 1) addIdx(i);
    return [...picked.values()];
  }

  function animeLibEpisodes(detail, releaseId) {
    if (!detail) return Promise.resolve({ sampled: [], all: [], isPartial: false });
    const cacheKey = `animelib:episodes:${releaseId}`;
    const emptyResult = { sampled: [], all: [], isPartial: false };
    return cached(cacheKey, async () => {
      const anime = await findAnimeLibTitle(detail);
      if (!anime?.id) return emptyResult;
      const listPayload = await animeLibJson('/api/episodes', { anime_id: String(anime.id) });
      const rawEpisodes = Array.isArray(listPayload?.data) ? listPayload.data : [];
      if (rawEpisodes.length === 0) return emptyResult;

      const normalized = rawEpisodes
        .map((ep) => ({
          epId: ep.id,
          position: Number(ep.number ?? ep.item_number),
          name: ep.name,
        }))
        .filter((ep) => ep.epId && Number.isSafeInteger(ep.position) && ep.position >= 0);

      const toFetch = selectSampleEpisodes(normalized);
      const isPartial = toFetch.length < normalized.length;
      const detailsByEpId = new Map();

      for (let i = 0; i < toFetch.length; i += ANIME_LIB_BATCH_SIZE) {
        const batch = toFetch.slice(i, i + ANIME_LIB_BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((ep) => cached(`animelib:ep:${ep.epId}`, () =>
            animeLibJson(`/api/episodes/${ep.epId}`, {}, { useToken: true, anonymousFallback: true })
              .then((res) => res?.data ?? null))),
        );
        for (let j = 0; j < batch.length; j += 1) {
          const ep = batch[j];
          const full = settled[j]?.status === 'fulfilled' ? settled[j].value : null;
          const players = Array.isArray(full?.players) ? full.players : [];
          const directPlayers = players.filter((p) => Array.isArray(p?.video?.quality) && p.video.quality.length > 0);
          if (directPlayers.length > 0) {
            detailsByEpId.set(ep.epId, { ...ep, players: directPlayers });
          }
        }
      }
      return {
        sampled: [...detailsByEpId.values()],
        all: normalized.map((ep) => detailsByEpId.get(ep.epId) ?? { ...ep, players: null }),
        isPartial,
      };
    }).then((res) => {
      if (res) return res;
      // Short 10s negative cache prevents WatchModal's parallel workers from hammering a rate-limited API.
      cache.set(cacheKey, { expires: Date.now() + 10_000, result: Promise.resolve(emptyResult) });
      return emptyResult;
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
    const [official, detail, entry] = await Promise.all([
      cached(`types:${releaseId}`, () => release.getDubbers(releaseId)),
      releaseDetail(release, releaseId),
      catalog(release, releaseId),
    ]);
    const [videos, libData] = await Promise.all([
      entry ? yummyVideos(entry) : [],
      animeLibEpisodes(detail, releaseId),
    ]);
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
    for (const ep of libData.sampled ?? []) {
      for (const player of ep.players) {
        const { name, key } = animeLibTeamInfo(player);
        if (!key || known.has(key)) continue;
        if (!external.has(key)) external.set(key, { name, positions: new Set() });
        external.get(key).positions.add(ep.position);
      }
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
      const [detail, entry, types] = await Promise.all([
        releaseDetail(release, releaseId),
        catalog(release, releaseId),
        getDubbers(release, releaseId),
      ]);
      const type = types?.types?.find((item) => Number(item.id) === dubberId);
      const dub = translationKey(type?.name, type?.is_sub === true || type?.isSub === true);
      if (!dub || (!entry && !detail)) return [];
      const shikiId = entry?.shikiId;
      const [videos, uhd, libData] = await Promise.all([
        entry ? yummyVideos(entry) : [],
        shikiId && aniTypeToken ? cached(`anitype:${shikiId}`, () =>
          json(`https://${aniTypeHost}/videos/episodes/${shikiId}`)) : [],
        animeLibEpisodes(detail, releaseId),
      ]);
      const groups = new Map();
      function add(index, name, number, url, iframe, extra = {}) {
        const position = Number(number);
        if (!url || number == null || number === '' || !Number.isSafeInteger(position) || position < 0) return;
        const id = SOURCE_BASE + dubberId * SOURCE_STRIDE + index;
        const group = groups.get(id) ?? { id, name, episodes: new Map() };
        if (!group.episodes.has(position)) {
          group.episodes.set(position, { position, name: `Серия ${position}`, url, iframe, ...extra });
        }
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
      const dubFoundInSample = (libData.sampled ?? []).some((ep) =>
        ep.players.some((player) => animeLibTeamInfo(player).key === dub));
      if (dubFoundInSample) {
        for (const ep of libData.all ?? []) {
          if (Array.isArray(ep.players)) {
            const matched = ep.players.find((player) => animeLibTeamInfo(player).key === dub);
            if (!matched) continue;
            const epUrl = `${animeLibApiOrigin}/api/episodes/${ep.epId}${matched.team?.id ? `?team_id=${matched.team.id}` : ''}`;
            add(ANIME_LIB_INDEX, ANIME_LIB_NAME, ep.position, epUrl, false, {
              provider: 'animelib',
              epId: ep.epId,
              dub,
              qualities: matched.video?.quality ?? [],
            });
          } else if (libData.isPartial) {
            const epUrl = `${animeLibApiOrigin}/api/episodes/${ep.epId}`;
            add(ANIME_LIB_INDEX, ANIME_LIB_NAME, ep.position, epUrl, false, {
              provider: 'animelib',
              epId: ep.epId,
              dub,
              lazy: true,
              qualities: null,
            });
          }
        }
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
    const cvhHeaders = { 'User-Agent': BROWSER_UA };
    const playlist = await cached(`cvh:${id}`, () =>
      json(`${api}/playlist?pub=1&aggr=mali&id=${encodeURIComponent(id)}`, cvhHeaders));
    const item = playlist?.items?.find((entry) => String(entry.episode) === position && entry.voiceStudio === dub);
    if (!item?.vkId) return null;
    const video = await json(`${api}/video/${encodeURIComponent(item.vkId)}`, cvhHeaders);
    for (const [candidate, format] of [
      [video.sources?.hlsUrl, 'hls'],
      [video.sources?.dashUrl, 'dash'],
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
    if (episode.provider === 'animelib') {
      try {
        let rawQualities = Array.isArray(episode.qualities) ? episode.qualities : null;
        if ((!rawQualities || rawQualities.length === 0) && episode.epId) {
          const full = await cached(`animelib:ep:${episode.epId}`, () =>
            animeLibJson(`/api/episodes/${episode.epId}`, {}, { useToken: true, anonymousFallback: true })
              .then((res) => res?.data ?? null));
          const players = Array.isArray(full?.players) ? full.players : [];
          const matched = players.find((player) =>
            Array.isArray(player?.video?.quality) &&
            player.video.quality.length > 0 &&
            (!episode.dub || animeLibTeamInfo(player).key === episode.dub));
          rawQualities = matched?.video?.quality ?? [];
        }
        const entries = await Promise.all((rawQualities ?? []).map(async (item) => {
          const height = Number(item?.quality);
          const candidate = buildAnimeLibVideoUrl(item?.href);
          if (!Number.isInteger(height) || height <= 0 || !candidate) return null;
          const stream = resolveAnimeLibStream
            ? await resolveAnimeLibStream(candidate)
            : prepareStream(candidate);
          return stream ? [height, stream] : null;
        }));
        const qualityMap = Object.fromEntries(entries.filter(Boolean));
        const currentQuality = Object.keys(qualityMap).at(-1);
        if (!currentQuality) return null;
        return {
          position: episode.position,
          name: episode.name,
          url: qualityMap[currentQuality],
          iframe: false,
          qualityMap,
          currentQuality,
        };
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
      return {
        code: 0,
        episodes: episodes.map(({ position, name }) => ({ position, name, url: '', iframe: false })),
      };
    },

    async getEpisode(release, releaseId, sourceId, position) {
      if (sourceId < SOURCE_BASE) return release.getEpisode(releaseId, sourceId, position);
      const source = await getSource(release, releaseId, sourceId);
      return { code: 0, episode: await resolveEpisode(source?.episodes.get(Number(position))) ?? null };
    },
  };
}
