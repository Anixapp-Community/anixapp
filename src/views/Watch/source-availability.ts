import { isDashUrl, isHlsUrl, toCorsSafePlayUrl, toResolvedMediaUrl, unwrapMediaProxyUrl } from './_utils';
import { qualityHeight } from '../../utils/dubber-meta';

export type SourceAvailability = 'checking' | 'available' | 'proxy' | 'unavailable' | 'unknown' | 'manifest' | 'timeout' | 'network' | 'rateLimited';

export const sourceAvailabilityLabels: Record<SourceAvailability, string> = {
  checking: 'Проверяем…',
  available: 'Работает',
  proxy: 'Через прокси',
  unavailable: 'Недоступен',
  unknown: 'Видео не подтверждено',
  timeout: 'Долго отвечает',
  network: 'Ошибка подключения',
  rateLimited: 'Лимит запросов',
  manifest: 'Манифест доступен',
};

type Episode = { url: string; iframe?: boolean; availabilityVerified?: boolean; requireMediaBytes?: boolean };
type ProbeDetails = { maxHeight: number };
const checks = new Map<string, { expires: number; task: Promise<SourceAvailability>; details: ProbeDetails }>();
const retryAt = new Map<string, number>();

function absolute(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url;
}

function dashMediaSegment(mpd: Element, manifestUrl: string): string | null {
  const child = (node: Element, name: string) =>
    Array.from(node.children).find((element) => element.localName === name);
  for (const representation of Array.from(mpd.getElementsByTagNameNS('*', 'Representation'))) {
    const adaptation = representation.parentElement;
    const mimeType = representation.getAttribute('mimeType') ?? adaptation?.getAttribute('mimeType') ?? '';
    const contentType = representation.getAttribute('contentType') ?? adaptation?.getAttribute('contentType');
    const codecs = representation.getAttribute('codecs') ?? adaptation?.getAttribute('codecs') ?? '';
    if (contentType !== 'video' && !mimeType.startsWith('video/')
      && !representation.hasAttribute('height') && !/^(avc|hev|hvc|vp[089]|av01)/i.test(codecs)) continue;

    const chain: Element[] = [];
    for (let node: Element | null = representation; node; node = node.parentElement) chain.unshift(node);
    let base = manifestUrl;
    const templates: Element[] = [];
    let list: Element | undefined;
    for (const node of chain) {
      const value = child(node, 'BaseURL')?.textContent?.trim();
      if (value) {
        base = new URL(value, base).href;
      }
      const template = child(node, 'SegmentTemplate');
      if (template) templates.unshift(template);
      list = child(node, 'SegmentList') ?? list;
    }

    const attribute = (name: string) => templates.find((node) => node.hasAttribute(name))?.getAttribute(name);
    const media = attribute('media');
    if (media) {
      const timeline = templates.map((node) => child(node, 'SegmentTimeline')).find(Boolean);
      const start = (timeline && child(timeline, 'S')?.getAttribute('t')) ?? '0';
      const values: Record<string, string | null> = {
        RepresentationID: representation.getAttribute('id'),
        Bandwidth: representation.getAttribute('bandwidth'),
        Number: attribute('startNumber') ?? '1',
        Time: start,
      };
      let unresolved = false;
      const segment = media.replace(/\$\$|\$([A-Za-z]+)(?:%0(\d{1,2})d)?\$/g, (token, key: string, width: string) => {
        if (token === '$$') return '$';
        const value = values[key];
        if (value == null) { unresolved = true; return token; }
        return width ? value.padStart(Number(width), '0') : value;
      });
      if (!unresolved) return new URL(segment, base).href;
    }
    const segment = list && child(list, 'SegmentURL')?.getAttribute('media');
    if (segment) return new URL(segment, base).href;
  }
  return null;
}

async function probeEpisode(episode: Episode, details: ProbeDetails): Promise<SourceAvailability> {
  let url = absolute(episode.url);
  const proxy = /^(https?:\/\/[^/]+)?\/tv\/media\?/i.test(url);
  const good: SourceAvailability = proxy ? 'proxy' : 'available';
  if (episode.availabilityVerified && !episode.requireMediaBytes) return good;
  let referer: string | undefined;
  const libriaPage = /^https?:\/\/[^/]*(?:libria|liberty)\.[^/]+\//i.test(url) && !/\.mp4(?:[?#]|$)/i.test(url);
  if ((episode.iframe || libriaPage) && !isHlsUrl(url) && !isDashUrl(url)) {
    const result = await window.anixApi?.release.getDirectVideoLink(url);
    if (!result?.directUrl) return 'unavailable';
    details.maxHeight = Math.max(qualityHeight(result.quality), ...Object.keys(result.qualityMap ?? {}).map(qualityHeight));
    referer = result.downloadHeaders?.Referer ?? url;
    url = toResolvedMediaUrl(result.directUrl);
  }
  const request = async (target: string, manifest: boolean): Promise<{
    status: number; url: string; text?: string; type?: string | null; timeout?: boolean; hasBytes?: boolean;
  }> => {
    const host = new URL(unwrapMediaProxyUrl(target), location.href).host;
    if ((retryAt.get(host) ?? 0) > Date.now()) return { status: 429, url: target };
    const trackLimit = (status: number, retryAfter?: string | null) => {
      if (status !== 429) return;
      const now = Date.now();
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
      const until = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retryAfter ?? '');
      if (retryAt.size >= 100) retryAt.clear();
      retryAt.set(host, until > now ? until : now + 60_000);
    };
    const nativeProbe = window.anixApi?.release.probeSourceStream;
    if (nativeProbe && target.startsWith('anix-stream://')) {
      const result = await nativeProbe(target, manifest);
      trackLimit(result.status, result.retryAfter);
      return { ...result, url: target };
    }
    const response = await fetch(toCorsSafePlayUrl(target, referer), {
      signal: AbortSignal.timeout(8000),
      headers: manifest ? undefined : { Range: 'bytes=0-31' },
    });
    trackLimit(response.status, response.headers.get('Retry-After'));
    const text = manifest && response.ok ? await response.text() : undefined;
    let hasBytes: boolean | undefined;
    if (!manifest && response.ok && episode.requireMediaBytes && response.body) {
      const reader = response.body.getReader();
      try {
        hasBytes = Boolean((await reader.read()).value?.byteLength);
      } finally {
        void reader.cancel().catch(() => {});
      }
    } else if (text === undefined) void response.body?.cancel().catch(() => {});
    return { status: response.status, type: response.headers.get('Content-Type'), text, hasBytes, url: response.url, timeout: false };
  };
  const failure = (response: { status: number; timeout?: boolean }): SourceAvailability =>
    response.status === 429 ? 'rateLimited' : response.timeout ? 'timeout' : response.status === 0 ? 'network' : 'unavailable';
  let response = isHlsUrl(url) || isDashUrl(url) ? null : await request(url, false);
  if (response && (response.status < 200 || response.status >= 300)) return failure(response);
  const manifestType = /mpegurl|dash\+xml/i.test(response?.type ?? '');
  let mediaVerified = false;
  if (!response || manifestType) {
    for (let depth = 0; depth < 3; depth++) {
      const response = await request(url, true);
      if (response.status < 200 || response.status >= 300) return failure(response);
      const body = response.text ?? '';
      if (isDashUrl(url) || /dash\+xml/i.test(response.type ?? '')) {
        const mpd = new DOMParser().parseFromString(body, 'application/xml').documentElement;
        if (mpd.localName !== 'MPD') return 'unavailable';
        for (const video of mpd.querySelectorAll('Representation[height], AdaptationSet[height]')) {
          details.maxHeight = Math.max(details.maxHeight, Number(video.getAttribute('height')) || 0);
        }
        const segment = dashMediaSegment(mpd, unwrapMediaProxyUrl(response.url || url));
        if (!segment) return 'manifest';
        const manifest = new URL(url, location.href);
        const target = new URL(segment);
        url = manifest.protocol === 'anix-stream:' && target.protocol === 'https:' && target.host === manifest.host
          ? segment.replace(/^https:/, 'anix-stream:')
          : segment;
        mediaVerified = true;
        break;
      }
      if (!body.trimStart().startsWith('#EXTM3U')) return 'unavailable';
      for (const match of body.matchAll(/^#EXT-X-STREAM-INF:.*\bRESOLUTION=\d+x(\d+)/gim)) {
        details.maxHeight = Math.max(details.maxHeight, Number(match[1]));
      }
      const lines = body.split(/\r?\n/).map((line) => line.trim());
      const variant = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF:'));
      const next = lines.slice(variant + 1).find((line) => line && !line.startsWith('#'));
      if (!next) return 'manifest';
      const base = unwrapMediaProxyUrl(response.url || url);
      url = new URL(next, next.startsWith('/__anix/media?') ? location.origin : base).href;
      if (variant >= 0) continue;
      mediaVerified = true;
      break;
    }
    if (!mediaVerified) return 'manifest';
    response = await request(url, false);
  }
  if (response.status < 200 || response.status >= 300) return failure(response);
  if (episode.requireMediaBytes && !response.hasBytes) return 'unavailable';
  const type = response.type ?? '';
  return /^(video\/|audio\/|application\/octet-stream)/i.test(type)
    || (mediaVerified && response.status === 206) ? good : 'unknown';
}

export function checkEpisodeAvailability(episode: Episode, refresh = false, onQuality?: (height: number) => void): Promise<SourceAvailability> {
  if (!episode.url) return Promise.resolve('unavailable');
  const key = `${episode.iframe ? 'embed' : 'direct'}:${episode.requireMediaBytes ? 'bytes' : 'headers'}:${episode.url}`;
  const previous = checks.get(key);
  const report = (entry: { task: Promise<SourceAvailability>; details: ProbeDetails }) => onQuality
    ? entry.task.then((status) => {
        if (entry.details.maxHeight) onQuality(entry.details.maxHeight);
        return status;
      })
    : entry.task;
  if (!refresh && previous && previous.expires > Date.now()) return report(previous);
  if (checks.size >= 100) checks.clear();
  const details = { maxHeight: 0 };
  const task = probeEpisode(episode, details).catch((error): SourceAvailability =>
    error?.name === 'TimeoutError' ? 'timeout' : 'network');
  const entry = { task, details, expires: Date.now() + 60_000 };
  checks.set(key, entry);
  return report(entry);
}
