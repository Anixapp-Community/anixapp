const SOURCE_BASE = 100_000_000;
const SOURCE_STRIDE = 10;
const cvhHost = 'ru.yummyani.me';
const providers = [
  ['Aksor', 'player.aksor.tv'],
  ['Alloha', 'alloha.yani.tv'],
  ['CVH', cvhHost],
];
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
  studioband: 'sameband',
  sameband: 'sameband',
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

function studioMediaUrl(value, domain) {
  const url = secureUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname;
  return host === domain || host.endsWith('.' + domain) ? url : null;
}

function sameBandTitleKey(value) {
  const words = String(value ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.sort().join(' ');
}

function animeVostMediaUrl(value) {
  const url = String(value ?? '').replace(/^http:\/\/video\.animetop\.info\//i, 'https://video.animetop.info/');
  return secureUrl(url, 'video.animetop.info') ?? studioMediaUrl(url, 'animevost.org');
}

function episodePosition(name, index) {
  const match = /(?:^|\s)(\d+)\s*(?:серия|episode|$)/i.exec(String(name ?? '').trim());
  return match ? Number(match[1]) : index + 1;
}

export function createCustomSources({
  fetcher = globalThis.fetch, fetchMedia = fetcher,
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

  async function studioRequest(url, form) {
    const response = await fetcher(url, {
      ...(form && { method: 'POST', body: new URLSearchParams(form) }),
      redirect: 'error',
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error('Studio source unavailable');
    return response;
  }

  function studioEpisodes(detail, studio, catalogId) {
    if (!detail) return [];
    const shikiId = detail.shikiId || catalogId;
    return cached(`studio:${studio}:${shikiId ?? ''}:${detail.titleRu}:${detail.titleOrig}:${detail.year ?? ''}`, async () => {
      const titleMatches = (value) => [detail.titleRu, detail.titleOrig]
        .some((title) => title && normalize(title) === normalize(value));
      if (studio === 'AnimeVost') {
        const origin = 'https://api.animevost.org';
        let id;
        for (const name of new Set([detail.titleRu, detail.titleOrig].filter(Boolean))) {
          const search = await (await studioRequest(origin + '/v1/search', { name })).json();
          const matches = (Array.isArray(search.data) ? search.data : []).filter((item) =>
            String(item.title ?? '').split(/\s+\/\s+/).some((title) =>
              titleMatches(title.replace(/(?:\s*\[\s*\d+(?:\s*[-–]\s*\d+|\s+из\s+\d+\+?)*\s*\]\s*)+$/i, '')))
            && (!detail.year || !item.year || Number(item.year) === detail.year));
          if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].id))) continue;
          id = matches[0].id;
          break;
        }
        if (!id) return [];
        const rows = await (await studioRequest(origin + '/v1/playlist', { id })).json();
        return (Array.isArray(rows) ? rows : []).map((row, index) => ({
          position: episodePosition(row.name, index),
          qualities: { 480: animeVostMediaUrl(row.std), 720: animeVostMediaUrl(row.hd) },
        }));
      }
      const origin = 'https://sameband.studio';
      const urlOnSite = (value, base = origin) => {
        if (!value) return null;
        const url = new URL(value, base);
        return ['sameband.studio', 'sb.sameband.studio'].includes(url.hostname) ? secureUrl(url.href) : null;
      };
      // Anixart can omit the Shikimori ID, so match the verified first-season titles too.
      const firstSeason = shikiId === 52991 || (!shikiId && (!detail.year || detail.year === 2023) && (
        titleMatches('Sousou no Frieren') ||
        titleMatches('Провожающая в последний путь Фрирен') ||
        titleMatches('Фрирен: провожающая в последний путь')
      ));
      const confirmedPage = firstSeason
        ? 'https://sb.sameband.studio/anime/37-friren-provozhajuschaja-v-poslednij-put.html'
        : null;
      let page = confirmedPage;
      if (!page) {
        const search = await (await studioRequest(origin + '/index.php?do=search', {
          do: 'search', subaction: 'search', search_start: '0', full_search: '0', result_from: '1', story: detail.titleRu,
        })).text();
        const matches = new Set();
        for (const card of search.split(/<div\b[^>]*class=["'][^"']*\bcol-auto\b[^"']*["']/i).slice(1)) {
          const title = /<[^>]*class=["'][^"']*\bposter\b[^"']*["'][^>]*\btitle=["']([^"']+)/i.exec(card)?.[1];
          const link = /<a\b[^>]*\bhref=["']([^"']*\/anime\/[^"']+\.html)["']/i.exec(card)?.[1];
          if (link && title && [detail.titleRu, detail.titleOrig].some((name) =>
            name && sameBandTitleKey(name) === sameBandTitleKey(title))) matches.add(link);
        }
        if (matches.size !== 1) return [];
        page = urlOnSite([...matches][0]);
      }
      if (!page) return [];
      const html = await (await studioRequest(page)).text();
      const player = urlOnSite(/<iframe\b[^>]*\bsrc=["']([^"']*\/(?:pl\/a|v\/play)\/[^"']+)["']/i.exec(html)?.[1], page);
      if (!player) return [];
      const playerHtml = await (await studioRequest(player)).text();
      const playlist = urlOnSite(/\bfile\s*:\s*["']([^"']*\/v\/list\/[^"']+)["']/i.exec(playerHtml)?.[1], player);
      if (!playlist) return [];
      const rows = await (await studioRequest(playlist)).json();
      return (Array.isArray(rows) ? rows : []).map((row, index) => ({
        position: episodePosition(String(row.title ?? '').replace(/<[^>]*>/g, ''), index),
        qualities: Object.fromEntries(String(row.file ?? '').split(',').flatMap((item) => {
          const match = /^\[(\d+)p\](\/v\/[^,]+\.m3u8)$/i.exec(item.trim());
          const url = match && urlOnSite(match[2], playlist);
          return url ? [[match[1], url]] : [];
        })),
      }));
    });
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
  let animeLibRetryAt = 0;

  async function animeLibJson(path, params = {}, { useToken = false, anonymousFallback = true } = {}) {
    const origins = stickyAnimeLibOrigin === animeLibFallbackOrigin
      ? [animeLibFallbackOrigin, animeLibApiOrigin]
      : [animeLibApiOrigin, animeLibFallbackOrigin];
    let lastErr;
    for (const origin of origins) {
      if (Date.now() < animeLibRetryAt) break;
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
          const now = Date.now();
          const retryAfter = response.headers.get('Retry-After') ?? '';
          const until = /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
          animeLibRetryAt = Math.max(animeLibRetryAt, until > now ? until : now + 60_000);
          lastErr = new Error('AnimeLib HTTP 429');
          break;
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

  function maxQuality(qualities) {
    const heights = Array.isArray(qualities)
      ? qualities.map((item) => Number(item?.quality))
      : Object.keys(qualities ?? {}).filter((height) => qualities[height]).map(Number);
    return Math.max(0, ...heights.filter(Number.isFinite));
  }

  async function getDubbers(release, releaseId) {
    const [official, detail, entry] = await Promise.all([
      cached(`types:${releaseId}`, () => release.getDubbers(releaseId)),
      releaseDetail(release, releaseId),
      catalog(release, releaseId),
    ]);
    const [videos, libData, vost, band] = await Promise.all([
      entry ? yummyVideos(entry) : [],
      animeLibEpisodes(detail, releaseId),
      studioEpisodes(detail, 'AnimeVost', entry?.shikiId),
      studioEpisodes(detail, 'SameBand', entry?.shikiId),
    ]);
    const types = official?.types ?? [];
    const known = new Set(types.map((item) => translationKey(item.name, item.is_sub === true || item.isSub === true)));
    const external = new Map();
    const catalogQualities = new Map();
    const recordQuality = (key, height) => {
      if (key && height > (catalogQualities.get(key) ?? 0)) catalogQualities.set(key, height);
    };
    for (const [name, rows] of [['AnimeVost', vost], ['Studio Band', band]]) {
      const key = translationKey(name);
      for (const row of rows ?? []) recordQuality(key, maxQuality(row.qualities));
      const positions = new Set((rows ?? []).filter((row) => Object.values(row.qualities).some(Boolean)).map((row) => row.position));
      if (!known.has(key) && positions.size) external.set(key, { name, positions });
    }
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
        recordQuality(key, maxQuality(player.video?.quality));
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
      return { id, name: item.name, is_sub: key.startsWith('sub:'), is_external: true, episode_count: item.positions.size, max_quality: catalogQualities.get(key) };
    });
    if (!additions.length && !catalogQualities.size) return official;
    const enriched = types.map((item) => {
      const height = catalogQualities.get(translationKey(item.name, item.is_sub === true || item.isSub === true || item.type === 1));
      return height ? { ...item, max_quality: Math.max(Number(item.max_quality) || 0, height) } : item;
    });
    return { ...official, code: 0, types: [...enriched, ...additions] };
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
      const [videos, libData] = await Promise.all([
        entry ? yummyVideos(entry) : [],
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
      const studio = [['AnimeVost', 'AnimeVost', 5], ['Studio Band', 'SameBand', 6]]
        .find(([name]) => translationKey(name) === dub);
      if (studio) {
        const [, name, index] = studio;
        for (const row of (await studioEpisodes(detail, name, shikiId)) ?? []) {
          const url = Object.values(row.qualities).find(Boolean);
          add(index, name, row.position, url, false, { provider: 'studio', studio: name, qualities: row.qualities });
        }
      }
      for (const video of videos ?? []) {
        if (translationKey(video.data?.dubbing) !== dub) continue;
        const provider = yummyProvider(video);
        if (provider) add(provider.index, `${provider.name} (YummyAnime)`, video.number, provider.url, true);
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
    let adaptiveUrl;
    const qualityMap = {};
    async function probe(candidate, format) {
      const url = secureUrl(candidate);
      if (!url || !/(^|\.)okcdn\.ru$/.test(new URL(url).hostname)) return null;
      try {
        const response = await fetchMedia(url, {
          headers: format === 'mp4' ? { Range: 'bytes=0-1023' } : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(2500),
        });
        if (format !== 'mp4' && response.ok) {
          const body = (await response.text()).trimStart();
          if (format === 'hls' && body.startsWith('#EXTM3U')) {
            adaptiveUrl ??= url;
            const heights = new Set([...body.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map((match) => match[1]));
            if (heights.size > 1) return url;
          }
          if (format === 'dash' && /<MPD[\s>]/.test(body)) {
            const dashUrl = url + '#dash.mpd';
            adaptiveUrl ??= dashUrl;
            const heights = new Set([...body.matchAll(/<Representation\b[^>]*\bheight=["'](\d+)/gi)].map((match) => match[1]));
            if (heights.size > 1) return dashUrl;
          }
        } else {
          void response.body?.cancel().catch(() => {});
          if (response.ok && /^video\//i.test(response.headers.get('content-type') ?? '')) {
            return prepareStream(url);
          }
        }
      } catch {
        // Continue with the other formats when a signed link fails.
      }
      return null;
    }
    const adaptive = await probe(video.sources?.hlsUrl, 'hls') ?? await probe(video.sources?.dashUrl, 'dash');
    if (adaptive) return { url: adaptive };
    const formats = {
      mpeg4kUrl: 2160, mpegQhdUrl: 1440, mpegFullHdUrl: 1080, mpegHighUrl: 720,
      mpegMediumUrl: 480, mpegLowUrl: 360, mpegLowestUrl: 240, mpegTinyUrl: 144,
    };
    const entries = Object.entries(formats).filter(([key]) => video.sources?.[key]);
    for (let offset = 0; offset < entries.length; offset += 4) {
      await Promise.all(entries.slice(offset, offset + 4).map(async ([key, height]) => {
        const stream = await probe(video.sources[key], 'mp4');
        if (stream) qualityMap[height] = stream;
      }));
    }
    const currentQuality = Object.keys(qualityMap).at(-1);
    if (currentQuality && (!adaptiveUrl || Object.keys(qualityMap).length > 1)) {
      return { url: qualityMap[currentQuality], qualityMap, currentQuality };
    }
    return adaptiveUrl ? { url: adaptiveUrl } : null;
  }

  async function resolveEpisode(episode) {
    if (!episode) return null;
    if (episode.provider === 'studio') {
      const qualities = { ...episode.qualities };
      if (episode.studio === 'AnimeVost' && qualities[480] && qualities[720]) {
        const hd = await cached(`vost-hd:${qualities[720]}`, async () => {
          const response = await fetchMedia(qualities[720], {
            headers: { Range: 'bytes=0-31' }, signal: AbortSignal.timeout(2500),
          });
          void response.body?.cancel().catch(() => {});
          return response.ok && /^video\/|^application\/octet-stream/i.test(response.headers.get('content-type') ?? '');
        }, 20_000);
        if (!hd) delete qualities[720];
      }
      const qualityMap = Object.fromEntries(Object.entries(qualities).flatMap(([height, url]) => {
        const stream = url && prepareStream(url);
        return stream ? [[height, stream]] : [];
      }));
      const currentQuality = Object.keys(qualityMap).at(-1);
      return currentQuality ? { ...episode, url: qualityMap[currentQuality], qualityMap, currentQuality } : null;
    }
    if (episode.iframe) {
      try {
        const embed = new URL(episode.url);
        let url;
        if (embed.hostname === cvhHost) {
          const resolved = await cached(`cvh-stream:${embed.href}`, () => resolveCvh(embed.href), 20_000);
          const playable = resolved?.qualityMap ? resolved.url : resolved?.url && prepareStream(resolved.url);
          return playable ? { ...episode, ...resolved, url: playable, iframe: false } : null;
        }
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
          availabilityVerified: Boolean(resolveAnimeLibStream),
          qualityMap,
          currentQuality,
        };
      } catch {
        return null;
      }
    }
    return null;
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
      const existing = new Set((baseline?.sources ?? []).map(({ name }) => normalize(name)));
      return {
        ...baseline,
        code: 0,
        sources: [...(baseline?.sources ?? []), ...extra.filter(({ name }) => !existing.has(normalize(name))).map(({ id, name, episodes }) =>
          ({
            id, name, episodes_count: episodes.size,
            max_quality: Math.max(0, ...Array.from(episodes.values(), (episode) => maxQuality(episode.qualities))) || undefined,
          }))],
      };
    },

    async getEpisodes(release, releaseId, dubberId, sourceId, sort = 1) {
      if (sourceId < SOURCE_BASE) return release.getEpisodes(releaseId, dubberId, sourceId, sort);
      const source = await getSource(release, releaseId, sourceId);
      const episodes = [...(source?.episodes.values() ?? [])].sort((a, b) =>
        sort === 2 ? b.position - a.position : a.position - b.position);
      return {
        code: 0,
        episodes: episodes.map(({ position, name, qualities }) => ({
          position, name, url: '', iframe: false, max_quality: maxQuality(qualities) || undefined,
        })),
      };
    },

    async getEpisode(release, releaseId, sourceId, position) {
      if (sourceId < SOURCE_BASE) return release.getEpisode(releaseId, sourceId, position);
      const source = await getSource(release, releaseId, sourceId);
      return { code: 0, episode: await resolveEpisode(source?.episodes.get(Number(position))) ?? null };
    },
  };
}
