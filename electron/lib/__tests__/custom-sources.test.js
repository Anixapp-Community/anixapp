'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sourceStreamUrl } = require('../source-stream-protocol');

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('AnimeLib custom source integration', () => {
  it('supports cdnlibs.org in sourceStreamUrl', () => {
    assert.equal(
      sourceStreamUrl('https://video1.cdnlibs.org/.%D0%B0s/uploads/converted_videos/test_1080.mp4'),
      'anix-stream://video1.cdnlibs.org/.%D0%B0s/uploads/converted_videos/test_1080.mp4',
    );
  });

  it('discovers AnimeLib dubbers, sources, episodes, and resolves qualities without duplicating aliases', async () => {
    const { createCustomSources, isCustomSourceId } = await import('../custom-sources.mjs');

    const releaseEndpoints = {
      async info(id) {
        return {
          release: {
            id,
            title_original: 'Sousou no Frieren',
            title_ru: 'Провожающая в последний путь Фрирен',
            year: 2023,
            shikimori_id: 52991,
          },
        };
      },
      async getDubbers() {
        return {
          code: 0,
          types: [
            { id: 10, name: 'AniLiberty', view_count: 1000 },
            { id: 11, name: 'Дубляжная', view_count: 500 },
          ],
        };
      },
      async getDubberSources() {
        return {
          code: 0,
          sources: [{ id: 1, name: 'Kodik', episodes_count: 28 }],
        };
      },
      async getEpisodes() {
        return { code: 0, episodes: [] };
      },
      async getEpisode() {
        return { code: 0, episode: null };
      },
    };

    const fetcher = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());

      const isLibApi = url.hostname === 'api.cdnlibs.org' || url.hostname === 'api.imglib.info';
      if (isLibApi && url.pathname === '/api/anime') {
        return jsonResponse({
          data: [
            {
              id: 21371,
              name: 'Sousou no Frieren',
              rus_name: 'Провожающая в последний путь Фрирен',
              releaseDate: '2023-09-29',
            },
          ],
        });
      }

      if (isLibApi && url.pathname === '/api/episodes') {
        return jsonResponse({
          data: [{ id: 114114, anime_id: 21371, number: '1', season: '1' }],
        });
      }

      if (isLibApi && url.pathname === '/api/episodes/114114') {
        return jsonResponse({
          data: {
            id: 114114,
            anime_id: 21371,
            number: '1',
            players: [
              {
                id: 1,
                player: 'Kodik',
                team: { id: 1, name: 'AniLiberty (AniLibria)' },
                src: '//kodikplayer.com/seria/1/abc/720p',
                video: null,
              },
              {
                id: 2,
                player: 'Animelib',
                team: { id: 1, name: 'AniLiberty (AniLibria)' },
                video: {
                  quality: [
                    { href: '/uploads/ep1_360.mp4', quality: 360 },
                    { href: '/uploads/ep1_1080.mp4', quality: 1080 },
                  ],
                },
              },
              {
                id: 3,
                player: 'Animelib',
                team: { id: 99, name: 'HarukaDub' },
                video: {
                  quality: [{ href: '/uploads/haruka_720.mp4', quality: 720 }],
                },
              },
            ],
          },
        });
      }

      if (url.hostname === 'api.yani.tv' && url.pathname === '/search') {
        return jsonResponse({
          response: [{ anime_id: 777, remote_ids: { shikimori_id: 52991 } }],
        });
      }

      if (url.hostname === 'api.yani.tv' && url.pathname === '/anime/777/videos') {
        return jsonResponse({
          response: [
            {
              number: 1,
              iframe_url: 'https://ru.yummyani.me/v/1',
              data: { dubbing: 'Озвучка ТО Дубляжная', player: 'Плеер CVH' },
            },
            {
              number: 1,
              iframe_url: 'https://ru.yummyani.me/v/2',
              data: { dubbing: 'Озвучка AniLibria', player: 'Плеер CVH' },
            },
          ],
        });
      }

      return jsonResponse({}, 404);
    };

    const custom = createCustomSources({
      fetcher,
      prepareStream: (u) => sourceStreamUrl(u) || u,
    });

    // 1. Official AniLiberty and Дубляжная are NOT duplicated by "AniLiberty (AniLibria)", "AniLibria", or "ТО Дубляжная"
    const dubbers = await custom.getDubbers(releaseEndpoints, 19000);
    assert.deepEqual(
      dubbers.types.map((t) => t.name),
      ['AniLiberty', 'Дубляжная', 'HarukaDub'],
    );
    const haruka = dubbers.types.find((t) => t.name === 'HarukaDub');
    assert.equal(haruka.is_external, true);

    // 2. Official AniLiberty dubber gets both YummyAnime (AniLibria) and AnimeLib (AniLiberty (AniLibria))
    const anilibriaSources = await custom.getDubberSources(releaseEndpoints, 19000, 10);
    const animeLibSource = anilibriaSources.sources.find((s) => s.name === 'AnimeLib');
    assert.ok(animeLibSource);
    assert.ok(anilibriaSources.sources.some((s) => s.name === 'CVH (YummyAnime)'));
    assert.equal(isCustomSourceId(animeLibSource.id), true);
    assert.equal(animeLibSource.episodes_count, 1);

    // Official Дубляжная gets YummyAnime (ТО Дубляжная)
    const dublyazhnayaSources = await custom.getDubberSources(releaseEndpoints, 19000, 11);
    assert.ok(dublyazhnayaSources.sources.some((s) => s.name === 'CVH (YummyAnime)'));

    // 3. Episodes list
    const epList = await custom.getEpisodes(releaseEndpoints, 19000, 10, animeLibSource.id);
    assert.equal(epList.episodes.length, 1);
    assert.equal(epList.episodes[0].position, 1);

    // 4. Episode playback resolution (single slash after prefix)
    const webEpisode = await custom.getEpisode(releaseEndpoints, 19000, animeLibSource.id, 1, true);
    assert.equal(webEpisode.episode, null);
    const epDetail = await custom.getEpisode(releaseEndpoints, 19000, animeLibSource.id, 1);
    assert.equal(epDetail.episode.currentQuality, '1080');
    assert.equal(
      epDetail.episode.url,
      'anix-stream://video1.cdnlibs.org/.%D0%B0s/uploads/ep1_1080.mp4',
    );
    assert.deepEqual(epDetail.episode.qualityMap, {
      '360': 'anix-stream://video1.cdnlibs.org/.%D0%B0s/uploads/ep1_360.mp4',
      '1080': 'anix-stream://video1.cdnlibs.org/.%D0%B0s/uploads/ep1_1080.mp4',
    });

    const proxy = 'https://api.anixapp.com/tv/media';
    const withUnavailableQuality = createCustomSources({
      fetcher,
      resolveAnimeLibStream: async (url) => url.endsWith('_1080.mp4') ? null : proxy,
    });
    const fallback = await withUnavailableQuality.getEpisode(releaseEndpoints, 19000, animeLibSource.id, 1);
    assert.equal(fallback.episode.url, proxy);
    assert.equal(fallback.episode.currentQuality, '360');
    assert.deepEqual(fallback.episode.qualityMap, { '360': proxy });
  });

  it('resolves YummyAnime CVH with Chrome User-Agent and prefers HLS', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const seenUa = [];
    let progressive = false;
    const fetcher = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const ua = init?.headers?.['User-Agent'] ?? '';
      if (url.hostname === 'api.yani.tv' && url.pathname === '/search') {
        return jsonResponse({ response: [{ anime_id: 777, remote_ids: { shikimori_id: 52991 } }] });
      }
      if (url.hostname === 'api.yani.tv' && url.pathname === '/anime/777/videos') {
        return jsonResponse({
          response: [{
            number: 1,
            iframe_url: 'https://ru.yummyani.me/iframeCVH.html?dubbing_code=AniLiberty&anime_id=52991&episode=1',
            data: { dubbing: 'Озвучка AniLibria', player: 'Плеер CVH' },
          }],
        });
      }
      if (url.hostname === 'plapi.cdnvideohub.com' && url.pathname.endsWith('/playlist')) {
        seenUa.push(ua);
        return jsonResponse({ items: [{ episode: '01', voiceStudio: ' AniLiberty ', vkId: '999' }] });
      }
      if (url.hostname === 'plapi.cdnvideohub.com' && url.pathname.endsWith('/video/999')) {
        seenUa.push(ua);
        return jsonResponse({
          sources: {
            dashUrl: 'https://vd1.okcdn.ru/?id=1',
            hlsUrl: 'https://vd1.okcdn.ru/video.m3u8?id=1',
            ...(progressive && {
              mpegFullHdUrl: 'https://vd1.okcdn.ru/1080.mp4',
              mpegHighUrl: 'https://vd1.okcdn.ru/720.mp4',
              mpegMediumUrl: 'https://vd1.okcdn.ru/480.mp4',
            }),
          },
        });
      }
      if (url.hostname === 'vd1.okcdn.ru' && url.pathname === '/video.m3u8') {
        return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchunk.m3u8\n', { status: 200 });
      }
      if (url.hostname === 'vd1.okcdn.ru' && /^\/(720|1080)\.mp4$/.test(url.pathname)) {
        return new Response(new Uint8Array(32), { status: 206, headers: { 'Content-Type': 'video/mp4' } });
      }
      return jsonResponse({}, 404);
    };

    const releaseEndpoints = {
      async info(id) { return { release: { id, title_original: 'Frieren', shikimori_id: 52991 } }; },
      async getDubbers() { return { code: 0, types: [{ id: 10, name: 'AniLiberty' }] }; },
      async getDubberSources() { return { code: 0, sources: [] }; },
      async getEpisodes() { return { code: 0, episodes: [] }; },
      async getEpisode() { return { code: 0, episode: null }; },
    };

    const custom = createCustomSources({ fetcher });
    const sourcesRes = await custom.getDubberSources(releaseEndpoints, 1, 10);
    const cvh = sourcesRes.sources.find((s) => s.name === 'CVH (YummyAnime)');
    assert.ok(cvh);
    const web = await custom.getEpisode(releaseEndpoints, 1, cvh.id, 1, true);
    assert.equal(web.episode, null);
    assert.equal(seenUa.length, 0);
    const ep = await custom.getEpisode(releaseEndpoints, 1, cvh.id, 1);
    assert.equal(ep.episode.url, 'https://vd1.okcdn.ru/video.m3u8?id=1');
    assert.ok(seenUa.every((ua) => ua.includes('Chrome/122.0.0.0')));
    progressive = true;
    const direct = await createCustomSources({ fetcher }).getEpisode(releaseEndpoints, 1, cvh.id, 1);
    assert.deepEqual(direct.episode.qualityMap, {
      720: 'https://vd1.okcdn.ru/720.mp4',
      1080: 'https://vd1.okcdn.ru/1080.mp4',
    });
  });

  it('adds studio sources to an existing dub and exposes a new studio dub', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const fetcher = async (input) => {
      const url = new URL(input);
      if (url.hostname === 'api.animevost.org' && url.pathname === '/v1/search') {
        return jsonResponse({ data: [{ id: 123, title: 'Sousou no Frieren [1-28 из 28]', year: '2023' }] });
      }
      if (url.hostname === 'api.animevost.org' && url.pathname === '/v1/playlist') {
        return jsonResponse([{ name: '1 episode', std: 'https://media.animevost.org/1.mp4' }]);
      }
      if (url.hostname === 'sb.sameband.studio') {
        if (url.pathname.startsWith('/anime/37-')) return new Response('<iframe src="/v/play/frieren.html"></iframe>');
        if (url.pathname === '/v/play/frieren.html') return new Response('new Playerjs({file:"/v/list/frieren.txt"})');
        if (url.pathname === '/v/list/frieren.txt') return jsonResponse([{ title: '1', file: '[480p]/v/480.m3u8,[720p]/v/720.m3u8' }]);
      }
      return jsonResponse({}, 404);
    };
    const release = {
      async info() { return { release: { title_original: 'Sousou no Frieren', year: 2023 } }; },
      async getDubbers() { return { code: 0, types: [{ id: 10, name: 'AnimeVost' }] }; },
      async getDubberSources() { return { code: 0, sources: [{ id: 9, name: 'Kodik' }] }; },
    };
    const custom = createCustomSources({ fetcher, prepareStream: sourceStreamUrl });
    const { types } = await custom.getDubbers(release, 1);
    assert.deepEqual(types.map(({ name }) => name), ['AnimeVost', 'Studio Band']);
    const vost = await custom.getDubberSources(release, 1, 10);
    assert.deepEqual(vost.sources.map(({ name }) => name), ['Kodik', 'AnimeVost']);
    const band = await custom.getDubberSources(release, 1, types[1].id);
    assert.equal(band.sources[0].max_quality, 720);
    const { episode } = await custom.getEpisode(release, 1, band.sources[0].id, 1);
    assert.deepEqual(episode.qualityMap, {
      480: 'anix-stream://sb.sameband.studio/v/480.m3u8',
      720: 'anix-stream://sb.sameband.studio/v/720.m3u8',
    });
  });

  it('prefers main AnimeLib series over Mini Anime spinoff when long title_original only matches spinoff', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const fullRu = 'Безжалостная леди Ния Листон: Единственная в своём роде история воительницы-богоубийцы, перевоплотившейся в болезненную аристократку';
    const fullOrig = 'Kyouran Reijou Nia Liston: Byoujaku Reijou ni Tensei shita Kamigoroshi no Bujin no Karei naru Musouroku';

    const fetcher = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const isLibApi = url.hostname === 'api.cdnlibs.org' || url.hostname === 'api.imglib.info';
      if (isLibApi && url.pathname === '/api/anime') {
        const q = url.searchParams.get('q') ?? '';
        if (q === fullOrig) {
          return jsonResponse({
            data: [{ id: 27521, name: `${fullOrig} Mini Anime`, rus_name: 'Безжалостная леди Ния Листон: Мини-аниме' }],
          });
        }
        return jsonResponse({
          data: [
            { id: 27521, name: `${fullOrig} Mini Anime`, rus_name: 'Безжалостная леди Ния Листон: Мини-аниме' },
            { id: 26825, name: 'Kyouran Reijou Nia Liston', rus_name: fullRu },
          ],
        });
      }
      if (isLibApi && url.pathname === '/api/episodes') {
        const animeId = url.searchParams.get('anime_id');
        return jsonResponse({
          data: animeId === '26825' ? [{ id: 146766, anime_id: 26825, number: '1', season: '1' }] : [],
        });
      }
      if (isLibApi && url.pathname === '/api/episodes/146766') {
        return jsonResponse({
          data: {
            id: 146766,
            anime_id: 26825,
            number: '1',
            players: [
              { id: 1, player: 'Animelib', team: { id: 64748, name: 'AniLiberty (AniLibria)' }, video: { quality: [{ href: '/uploads/nia_1080.mp4', quality: 1080 }] } },
              { id: 2, player: 'Animelib', team: { id: 10, name: 'Studio Band' }, video: { quality: [{ href: '/uploads/sb_2160.mp4', quality: 2160 }] } },
            ],
          },
        });
      }
      return jsonResponse({}, 404);
    };

    const releaseEndpoints = {
      async info(id) { return { release: { id, title_original: fullOrig, title_ru: fullRu, shikimori_id: 60123 } }; },
      async getDubbers() { return { code: 0, types: [{ id: 10, name: 'AniLiberty' }, { id: 20, name: 'Studio Band' }] }; },
      async getDubberSources() { return { code: 0, sources: [] }; },
      async getEpisodes() { return { code: 0, episodes: [] }; },
      async getEpisode() { return { code: 0, episode: null }; },
    };

    const custom = createCustomSources({ fetcher });
    const aniLibertySources = await custom.getDubberSources(releaseEndpoints, 20672, 10);
    const studioBandSources = await custom.getDubberSources(releaseEndpoints, 20672, 20);
    assert.ok(aniLibertySources.sources.some((s) => s.name === 'AnimeLib'));
    assert.ok(studioBandSources.sources.some((s) => s.name === 'AnimeLib'));
  });

  it('samples long AnimeLib series (>24 episodes) and lazy-resolves unsampled episodes with API failover', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const detailFetches = [];
    const totalEps = 30;
    const allEps = Array.from({ length: totalEps }, (_, i) => ({
      id: 5000 + i + 1,
      anime_id: 999,
      number: String(i + 1),
      season: '1',
    }));

    const fetcher = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      // Simulate primary api.cdnlibs.org failure on first call -> failover to api.imglib.info
      if (url.hostname === 'api.cdnlibs.org' && url.pathname === '/api/anime') {
        throw new Error('primary timeout');
      }
      if (url.hostname === 'api.imglib.info' && url.pathname === '/api/anime') {
        return jsonResponse({ data: [{ id: 999, name: 'Long Show', rus_name: 'Длинное шоу' }] });
      }
      if (url.pathname === '/api/episodes') {
        return jsonResponse({ data: allEps });
      }
      const epMatch = /^\/api\/episodes\/(\d+)$/.exec(url.pathname);
      if (epMatch) {
        const epId = Number(epMatch[1]);
        detailFetches.push(epId);
        return jsonResponse({
          data: {
            id: epId,
            anime_id: 999,
            number: String(epId - 5000),
            players: [
              {
                id: 1,
                player: 'Animelib',
                team: { id: 10, name: 'Studio Band' },
                video: { quality: [{ href: `/uploads/ep_${epId - 5000}_1080.mp4`, quality: 1080 }] },
              },
            ],
          },
        });
      }
      return jsonResponse({}, 404);
    };

    const releaseEndpoints = {
      async info(id) { return { release: { id, title_original: 'Long Show', title_ru: 'Длинное шоу' } }; },
      async getDubbers() { return { code: 0, types: [{ id: 10, name: 'Studio Band' }] }; },
      async getDubberSources() { return { code: 0, sources: [] }; },
      async getEpisodes() { return { code: 0, episodes: [] }; },
      async getEpisode() { return { code: 0, episode: null }; },
    };

    const custom = createCustomSources({ fetcher });
    const srcs = await custom.getDubberSources(releaseEndpoints, 30000, 10);
    const lib = srcs.sources.find((s) => s.name === 'AnimeLib');
    assert.ok(lib);
    assert.equal(lib.episodes_count, 30);
    // Should sample only 12 episodes, NOT all 30!
    assert.equal(detailFetches.length, 12);

    // Unsampled episode (e.g. ep 10 -> 5010) lazy-resolves on getEpisode
    const ep10 = await custom.getEpisode(releaseEndpoints, 30000, lib.id, 10);
    assert.equal(ep10.episode.url, 'https://video1.cdnlibs.org/.%D0%B0s/uploads/ep_10_1080.mp4');
    assert.equal(detailFetches.includes(5010), true);
  });

  it('forwards Content-Length and normalized Accept-Ranges on anix-stream:// progressive responses', () => {
    const { buildStreamResponseHeaders } = require('../source-stream-protocol');
    const upstreamHeaders = new Headers({
      'content-type': 'video/mp4',
      'content-length': '485292971',
      'content-range': 'bytes 0-485292970/485292971',
      'accept-ranges': 'bytes, bytes',
    });
    const out = buildStreamResponseHeaders(upstreamHeaders, 206);
    assert.equal(out.get('content-type'), 'video/mp4');
    assert.equal(out.get('content-length'), '485292971');
    assert.equal(out.get('content-range'), 'bytes 0-485292970/485292971');
    assert.equal(out.get('accept-ranges'), 'bytes');
    assert.match(out.get('access-control-expose-headers') || '', /Content-Length/);
  });

  it('extracts native AnimeLib timecodes and YummyAnime skips when present', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const releaseEndpoints = {
      async info(id) {
        return { release: { id, title_original: 'Skip Show', title_ru: 'Таймскип шоу', shikimori_id: 52991 } };
      },
      async getDubbers() { return { code: 0, types: [{ id: 10, name: 'AniLiberty' }] }; },
      async getDubberSources() { return { code: 0, sources: [] }; },
      async getEpisodes() { return { code: 0, episodes: [] }; },
      async getEpisode() { return { code: 0, episode: null }; },
    };

    const fetcher = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.hostname === 'api.cdnlibs.org' && url.pathname === '/api/anime') {
        return jsonResponse({ data: [{ id: 88, name: 'Skip Show', rus_name: 'Таймскип шоу' }] });
      }
      if (url.hostname === 'api.cdnlibs.org' && url.pathname === '/api/episodes') {
        return jsonResponse({ data: [{ id: 901, anime_id: 88, number: '1' }, { id: 902, anime_id: 88, number: '2' }] });
      }
      if (url.hostname === 'api.cdnlibs.org' && url.pathname === '/api/episodes/901') {
        return jsonResponse({
          data: {
            id: 901,
            players: [{
              player: 'Animelib',
              team: { id: 1, name: 'AniLiberty' },
              timecode: [{ type: 'op', from: 90, to: 180 }, { type: 'ed', from: 1320, to: 1410 }],
              video: { quality: [{ href: '/uploads/ep1_1080.mp4', quality: 1080 }] },
            }],
          },
        });
      }
      if (url.hostname === 'api.cdnlibs.org' && url.pathname === '/api/episodes/902') {
        return jsonResponse({
          data: {
            id: 902,
            players: [{
              player: 'Animelib',
              team: { id: 1, name: 'AniLiberty' },
              timecode: [],
              video: { quality: [{ href: '/uploads/ep2_1080.mp4', quality: 1080 }] },
            }],
          },
        });
      }
      if (url.hostname === 'api.yani.tv' && url.pathname === '/search') {
        return jsonResponse({ response: [{ anime_id: 777, remote_ids: { shikimori_id: 52991 } }] });
      }
      if (url.hostname === 'api.yani.tv' && url.pathname === '/anime/777/videos') {
        return jsonResponse({
          response: [{
            number: 1,
            iframe_url: 'https://player.aksor.tv/video/abcdef123456',
            data: { dubbing: 'Озвучка AniLiberty', player: 'Плеер Aksor' },
            skips: { opening: { start: 10, end: 100 }, ending: { start: 1300, end: 1390 } },
          }],
        });
      }
      if (url.hostname === 'player.aksor.tv') {
        return jsonResponse({ qualities: { q1080: 'https://cdn.tut-video.net/v/ep1.mpd' } });
      }
      return jsonResponse({}, 404);
    };

    const custom = createCustomSources({ fetcher });
    const srcs = await custom.getDubberSources(releaseEndpoints, 40000, 10);
    const lib = srcs.sources.find((s) => s.name === 'AnimeLib');
    const aksor = srcs.sources.find((s) => s.name === 'Aksor (YummyAnime)');
    assert.ok(lib && aksor);

    // 1. AnimeLib native timecodes
    const libEp1 = await custom.getEpisode(releaseEndpoints, 40000, lib.id, 1);
    assert.deepEqual(libEp1.episode.skip, { opening: { start: 90, end: 180 }, ending: { start: 1320, end: 1410 } });

    // 2. AnimeLib without native timecodes -> skip stays undefined
    const libEp2 = await custom.getEpisode(releaseEndpoints, 40000, lib.id, 2);
    assert.equal(libEp2.episode.skip, undefined);

    // 3. YummyAnime native skips
    const aksorEp1 = await custom.getEpisode(releaseEndpoints, 40000, aksor.id, 1);
    assert.deepEqual(aksorEp1.episode.skip, { opening: { start: 10, end: 100 }, ending: { start: 1300, end: 1390 } });
  });
});

describe('DreamCast custom source integration', () => {
  it('supports play.dreamerscast.com in sourceStreamUrl', () => {
    assert.equal(
      sourceStreamUrl('https://play.dreamerscast.com/hls/test/master.m3u8'),
      'anix-stream://play.dreamerscast.com/hls/test/master.m3u8',
    );
  });

  it('discovers DreamCast dubber, decodes PlayerJS playlist, and resolves HLS stream', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const releaseEndpoints = {
      async info() {
        return {
          release: {
            id: 60001,
            title_original: 'Sousou no Frieren 2nd Season',
            title_ru: 'Провожающая в последний путь Фрирен 2',
            year: 2026,
            shikimori_id: 59978,
          },
        };
      },
      async getDubbers() {
        return { code: 0, types: [{ id: 10, name: 'AniLiberty' }] };
      },
      async getDubberSources() {
        return { code: 0, sources: [] };
      },
    };

    const playlistJson = JSON.stringify({
      file: [
        {
          title: 'Серия 1',
          file: 'https://play.dreamerscast.com/dash/ep1/manifest.mpd or https://play.dreamerscast.com/hls/ep1/master.m3u8',
        },
        {
          title: 'Серия 2',
          file: 'https://play.dreamerscast.com/hls/ep2/master.m3u8',
        },
      ],
    });
    const marker = '//' + Buffer.from(encodeURIComponent('KEY0')).toString('base64');
    const b64Payload = Buffer.from(encodeURIComponent(playlistJson)).toString('base64');
    const encodedPlaylist = '#2' + b64Payload.slice(0, 8) + marker + b64Payload.slice(8);
    const vJson = JSON.stringify({ bk0: 'KEY0' });
    const saltAbc = 'ABCDEFGHIJKLMabcdefghijklmNOPQRSTUVWXYZnopqrstuvwxyz0123456789+/=';
    const stdAbc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const stdB64 = Buffer.from(vJson, 'utf8').toString('base64');
    const rawU = '#0' + [...stdB64].map((c) => saltAbc[stdAbc.indexOf(c)]).join('');
    const packedJs = String.raw`eval(function(p,a,c,k,e,d){return p}('0:\'${rawU}\\';',1,1,'u|'.split('|'),0,{}))`;

    const fetcher = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.hostname === 'dreamerscast.com' && url.pathname === '/') {
        return jsonResponse({
          releases: [
            {
              id: 524,
              russian: 'Провожающая в последний путь Фрирен 2',
              original: 'Sousou no Frieren 2nd Season',
              dateissue: 2026,
              url: '/home/release/524-sousou-no-frieren-2',
            },
          ],
        });
      }
      if (url.hostname === 'dreamerscast.com' && url.pathname === '/home/release/524-sousou-no-frieren-2') {
        return new Response(
          `<script src="/js/playerjs.min.js?v=test1"></script><script>new Playerjs("${encodedPlaylist}");</script>`,
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      if (url.hostname === 'dreamerscast.com' && url.pathname === '/js/playerjs.min.js') {
        return new Response(packedJs, { status: 200, headers: { 'content-type': 'application/javascript' } });
      }
      return jsonResponse({}, 404);
    };

    const custom = createCustomSources({ fetcher });
    const dubbers = await custom.getDubbers(releaseEndpoints, 60001);
    const dreamDub = dubbers.types.find((t) => t.name === 'DreamCast');
    assert.ok(dreamDub && dreamDub.episode_count === 2);

    const srcs = await custom.getDubberSources(releaseEndpoints, 60001, dreamDub.id);
    const dreamSrc = srcs.sources.find((s) => s.name === 'DreamCast');
    assert.ok(dreamSrc && dreamSrc.episodes_count === 2);

    const eps = await custom.getEpisodes(releaseEndpoints, 60001, dreamDub.id, dreamSrc.id);
    assert.equal(eps.episodes.length, 2);

    const ep1 = await custom.getEpisode(releaseEndpoints, 60001, dreamSrc.id, 1);
    assert.equal(ep1.episode.iframe, false);
    assert.equal(ep1.episode.url, 'https://play.dreamerscast.com/hls/ep1/master.m3u8');
  });

  it('merges JAM and JAM CLUB into a single dubber', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const releaseEndpoints = {
      async info() {
        return {
          release: {
            id: 60002,
            title_original: 'Test Anime',
            title_ru: 'Тест',
            year: 2025,
            shikimori_id: 99999,
          },
        };
      },
      async getDubbers() {
        return { code: 0, types: [{ id: 12, name: 'JAM CLUB' }] };
      },
      async getDubberSources() {
        return { code: 0, sources: [] };
      },
    };

    const fetcher = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.hostname === 'api.yani.tv' && url.pathname === '/search') {
        return jsonResponse({ response: [{ anime_id: 888, remote_ids: { shikimori_id: 99999 } }] });
      }
      if (url.hostname === 'api.yani.tv' && url.pathname === '/anime/888/videos') {
        return jsonResponse({
          response: [{
            number: 1,
            iframe_url: 'https://player.aksor.tv/video/abcdef123456',
            data: { dubbing: 'Озвучка JAM', player: 'Плеер Aksor' },
          }],
        });
      }
      return jsonResponse({}, 404);
    };

    const custom = createCustomSources({ fetcher });
    const dubbers = await custom.getDubbers(releaseEndpoints, 60002);
    assert.equal(dubbers.types.length, 1);
    assert.equal(dubbers.types[0].name, 'JAM CLUB');

    const srcs = await custom.getDubberSources(releaseEndpoints, 60002, 12);
    assert.ok(srcs.sources.some((s) => s.name === 'Aksor (YummyAnime)'));
  });

  it('does not stall getDubbers when external providers hang without VPN', async () => {
    const { createCustomSources } = await import('../custom-sources.mjs');
    const releaseEndpoints = {
      async info() {
        return {
          release: {
            id: 60003,
            title_original: 'Hanging Test',
            title_ru: 'Зависающий тест',
            year: 2025,
            shikimori_id: 77777,
          },
        };
      },
      async getDubbers() {
        return { code: 0, types: [{ id: 1, name: 'AniLiberty' }] };
      },
      async getDubberSources() {
        return { code: 0, sources: [] };
      },
    };

    const fetcher = () => new Promise(() => {});
    const custom = createCustomSources({ fetcher });
    const fastStarted = Date.now();
    const fast = await custom.getDubbersOfficial(releaseEndpoints, 60003);
    assert.equal(fast.types.length, 1);
    assert.ok(Date.now() - fastStarted < 100);

    const started = Date.now();
    const dubbers = await custom.getDubbers(releaseEndpoints, 60003);
    const elapsed = Date.now() - started;

    assert.equal(dubbers.types.length, 1);
    assert.equal(dubbers.types[0].name, 'AniLiberty');
    assert.ok(elapsed < 7500, `Expected bounded fallback under 7500ms, got ${elapsed}ms`);
  });
});
