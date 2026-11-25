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
        return jsonResponse({ items: [{ episode: '1', voiceStudio: 'AniLiberty', vkId: '999' }] });
      }
      if (url.hostname === 'plapi.cdnvideohub.com' && url.pathname.endsWith('/video/999')) {
        seenUa.push(ua);
        return jsonResponse({
          sources: {
            dashUrl: 'https://vd1.okcdn.ru/?id=1',
            hlsUrl: 'https://vd1.okcdn.ru/video.m3u8?id=1',
          },
        });
      }
      if (url.hostname === 'vd1.okcdn.ru' && url.pathname === '/video.m3u8') {
        return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchunk.m3u8\n', { status: 200 });
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
    const ep = await custom.getEpisode(releaseEndpoints, 1, cvh.id, 1);
    assert.equal(ep.episode.url, 'https://vd1.okcdn.ru/video.m3u8?id=1');
    assert.ok(seenUa.every((ua) => ua.includes('Chrome/122.0.0.0')));
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
});
