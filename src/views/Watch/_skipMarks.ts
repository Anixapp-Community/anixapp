import { episodeDisplayNumber } from '../../utils/episode-display';

export interface SkipRange {
  start: number;
  end: number;
}

export interface SkipMarks {
  opening: SkipRange | null;
  ending: SkipRange | null;
}

export type SkipMarkKind = 'opening' | 'ending';

/** Короткий бампер озвучки в начале — не опенинг. */
const INTRO_MAX_DURATION = 45;

function usable(start: unknown, end: unknown): SkipRange | null {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 2) return null;
  return { start: a, end: b };
}

function isVoiceoverIntro(range: SkipRange | null | undefined): boolean {
  if (!range) return false;
  const dur = range.end - range.start;
  return dur > 0 && dur < INTRO_MAX_DURATION && range.start < 90;
}

export function normalizeSkipMarks(raw: unknown): SkipMarks | null {
  if (!raw || typeof raw !== 'object') return null;
  const skip = raw as Record<string, unknown>;
  let opening = usable(
    (skip.opening as SkipRange | undefined)?.start,
    (skip.opening as SkipRange | undefined)?.end,
  );
  const ending = usable(
    (skip.ending as SkipRange | undefined)?.start,
    (skip.ending as SkipRange | undefined)?.end,
  );
  if (isVoiceoverIntro(opening)) opening = null;
  if (!opening && !ending) return null;
  return { opening, ending };
}

export function mergeSkipMarks(incoming: SkipMarks | null | undefined, carry: SkipMarks | null | undefined): SkipMarks | null {
  const opening = incoming?.opening ?? carry?.opening ?? null;
  const ending = incoming?.ending ?? carry?.ending ?? null;
  if (!opening && !ending) return null;
  return { opening, ending };
}

/** Подрезать OP/ED под длительность файла, если серия короче предыдущей. */
export function clampSkipMarksToDuration(marks: SkipMarks | null | undefined, duration: number): SkipMarks | null {
  if (!marks) return null;
  if (!(duration > 2)) return marks;
  const clampRange = (range: SkipRange | null): SkipRange | null => {
    if (!range) return null;
    if (range.start >= duration - 1) return null;
    return usable(range.start, Math.min(range.end, duration));
  };
  let opening = clampRange(marks.opening);
  const ending = clampRange(marks.ending);
  if (isVoiceoverIntro(opening)) opening = null;
  if (!opening && !ending) return null;
  return { opening, ending };
}

/**
 * Показать кнопку скипа.
 * Opening/Ending: только внутри отмеченного интервала.
 * (Не с начала серии — иначе вырежем сцену до OP, если опенинг не с 0:00.)
 */
export function skipMarkActive(
  t: number,
  range: SkipRange | null | undefined,
  kind: SkipMarkKind = 'ending',
): boolean {
  if (!range || !Number.isFinite(t)) return false;
  return t >= range.start - 0.35 && t < range.end - 0.45;
}

/** Точка на прогрессе — пока смотрят OP/ED, включая самый край интервала. */
export function skipMarkOnPlayhead(t: number, range: SkipRange | null | undefined): boolean {
  if (!range || !Number.isFinite(t)) return false;
  return t >= range.start - 0.2 && t <= range.end + 0.25;
}

/** После эндинга почти сразу конец файла — смысла в «пропустить» нет. */
export function endingIsAtEpisodeEnd(range: SkipRange | null | undefined, duration: number): boolean {
  if (!range || !(duration > 0)) return false;
  return duration - range.end <= 12 || range.end / duration >= 0.97;
}

export interface TimelineSausage {
  id: string;
  startPct: number;
  widthPct: number;
  kind: 'content' | SkipMarkKind;
}

function pctOf(t: number, duration: number): number {
  return Math.max(0, Math.min(100, (t / duration) * 100));
}

/** Таймлайн режется по границам OP/ED — каждый кусок круглая «сосиска». */
export function buildTimelineSausages(
  duration: number,
  opening: SkipRange | null | undefined,
  ending: SkipRange | null | undefined,
): TimelineSausage[] {
  if (!(duration > 0)) return [{ id: 'all', startPct: 0, widthPct: 100, kind: 'content' }];

  const cuts = new Set<number>([0, 100]);
  if (opening) {
    cuts.add(pctOf(opening.start, duration));
    cuts.add(pctOf(opening.end, duration));
  }
  if (ending) {
    cuts.add(pctOf(ending.start, duration));
    cuts.add(pctOf(ending.end, duration));
  }

  const points = [...cuts].sort((a, b) => a - b);
  const out: TimelineSausage[] = [];
  const opStart = opening ? pctOf(opening.start, duration) : -1;
  const opEnd = opening ? pctOf(opening.end, duration) : -1;
  const edStart = ending ? pctOf(ending.start, duration) : -1;
  const edEnd = ending ? pctOf(ending.end, duration) : -1;

  for (let i = 0; i < points.length - 1; i++) {
    const startPct = points[i];
    const endPct = points[i + 1];
    const widthPct = endPct - startPct;
    if (widthPct < 0.08) continue;
    const mid = startPct + widthPct / 2;
    let kind: TimelineSausage['kind'] = 'content';
    if (opening && mid >= opStart && mid < opEnd) kind = 'opening';
    else if (ending && mid >= edStart && mid < edEnd) kind = 'ending';
    out.push({ id: `${kind}-${startPct.toFixed(2)}`, startPct, widthPct, kind });
  }

  return out.length > 0 ? out : [{ id: 'all', startPct: 0, widthPct: 100, kind: 'content' }];
}

const KODIK_SKIP_TTL_MS = 10 * 60 * 1000;
const kodikSkipCache = new Map<string, { expires: number; value: SkipMarks | null }>();
const kodikSkipInflight = new Map<string, Promise<SkipMarks | null>>();

type ReleaseBridgeApi = {
  getDubbers?: (releaseId: number) => Promise<{ types?: Array<{ id: number; name?: string }> }>;
  getDubberSources?: (releaseId: number, dubberId: number) => Promise<{ sources?: Array<{ id: number; name?: string }> }>;
  getEpisodes?: (releaseId: number, dubberId: number, sourceId: number) => Promise<{ episodes?: Array<{ position: number; name?: string; url?: string }> }>;
  getEpisode?: (releaseId: number, sourceId: number, position: number) => Promise<{ episode?: { url?: string } | null }>;
  getDirectVideoLink?: (embedUrl: string) => Promise<{ skip?: unknown } | null>;
};

export interface KodikSkipFallbackParams {
  releaseId: number;
  currentSourceId?: number | null;
  dubberId?: number | null;
  dubberName?: string | null;
  episodePosition: number;
  episodeName?: string | null;
  episodes?: Array<{ position: number; name?: string }>;
}

/**
 * Fallback lookup for skip marks via Kodik when the active source did not provide timestamps.
 * Tries the active dubber's Kodik source first, then other dubbers' Kodik sources.
 */
export async function fetchKodikFallbackSkipMarks(params: KodikSkipFallbackParams): Promise<SkipMarks | null> {
  const rId = Math.trunc(Number(params.releaseId));
  if (!(rId > 0)) return null;

  const list = params.episodes ?? [];
  const rawNum = episodeDisplayNumber(
    list.find((e) => e.position === params.episodePosition) ?? {
      position: params.episodePosition,
      name: params.episodeName ?? null,
    },
    list,
  );
  const displayNum = rawNum > 0 ? rawNum : (params.episodePosition === 0 ? 1 : 0);
  if (!(displayNum > 0)) return null;

  const dubKey = String(params.dubberId || params.dubberName || '').trim().toLowerCase();
  const cacheKey = `${rId}:${dubKey}:${displayNum}`;
  const hit = kodikSkipCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = kodikSkipInflight.get(cacheKey);
  if (pending) return pending;

  const task = (async (): Promise<SkipMarks | null> => {
    try {
      const api = (window as unknown as { anixApi?: { release?: ReleaseBridgeApi } }).anixApi?.release;
      if (!api?.getDubbers || !api?.getDubberSources || !api?.getDirectVideoLink) return null;

      const dubRes = await api.getDubbers(rId);
      const dubbers = dubRes?.types ?? [];
      if (!dubbers.length) return null;

      const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const wantDub = norm(params.dubberName);
      const preferredDub = dubbers.find((d) => params.dubberId != null && Number(d.id) === Number(params.dubberId))
        ?? dubbers.find((d) => wantDub && (norm(d.name) === wantDub || norm(d.name).includes(wantDub) || wantDub.includes(norm(d.name))));

      const orderedDubs = preferredDub
        ? [preferredDub, ...dubbers.filter((d) => d.id !== preferredDub.id)]
        : dubbers;

      for (const dub of orderedDubs) {
        let sources: Array<{ id: number; name?: string }> = [];
        try {
          sources = (await api.getDubberSources(rId, dub.id))?.sources ?? [];
        } catch {
          continue;
        }
        const kodikSources = sources.filter((s) =>
          /kodik|aniqit/i.test(String(s.name ?? '')) && Number(s.id) !== Number(params.currentSourceId));
        for (const src of kodikSources) {
          let embedUrl: string | undefined;
          if (api.getEpisode) {
            try {
              embedUrl = (await api.getEpisode(rId, src.id, displayNum))?.episode?.url;
            } catch { /* fallback to episodes list */ }
          }
          if (!embedUrl && api.getEpisodes) {
            try {
              const eps = (await api.getEpisodes(rId, dub.id, src.id))?.episodes ?? [];
              const match = eps.find((e) => episodeDisplayNumber(e, eps) === displayNum) ?? eps.find((e) => e.position === displayNum);
              embedUrl = match?.url;
            } catch { /* ignore */ }
          }
          if (!embedUrl) continue;
          try {
            const direct = await api.getDirectVideoLink(embedUrl);
            const skip = normalizeSkipMarks(direct?.skip);
            if (skip) {
              kodikSkipCache.set(cacheKey, { expires: Date.now() + KODIK_SKIP_TTL_MS, value: skip });
              return skip;
            }
          } catch { /* try next Kodik source */ }
        }
      }
      kodikSkipCache.set(cacheKey, { expires: Date.now() + KODIK_SKIP_TTL_MS, value: null });
      return null;
    } catch {
      return null;
    } finally {
      kodikSkipInflight.delete(cacheKey);
    }
  })();

  kodikSkipInflight.set(cacheKey, task);
  return task;
}

const KODIK_TOLERANCE_SEC = 15;

function rangesDiffer(a: SkipRange | null, b: SkipRange | null, toleranceSec = KODIK_TOLERANCE_SEC): boolean {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return Math.abs(a.start - b.start) > toleranceSec || Math.abs(a.end - b.end) > toleranceSec;
}

export function skipMarksDisagree(
  source: SkipMarks | null | undefined,
  kodik: SkipMarks | null | undefined,
  toleranceSec = KODIK_TOLERANCE_SEC,
): boolean {
  if (!source) return !!kodik;
  if (!kodik) return false;
  return rangesDiffer(source.opening, kodik.opening, toleranceSec)
    || rangesDiffer(source.ending, kodik.ending, toleranceSec);
}

/**
 * Cross-references non-Kodik skip marks (e.g. AnimeLib, AniLibria) against Kodik.
 * Returns Kodik's marks if source marks are missing or disagree beyond tolerance.
 */
export async function resolveVerifiedSkipMarks(
  sourceSkip: SkipMarks | null | undefined,
  params: KodikSkipFallbackParams,
): Promise<SkipMarks | null> {
  const kodikSkip = await fetchKodikFallbackSkipMarks(params);
  if (!sourceSkip) return kodikSkip;
  if (!kodikSkip) return sourceSkip;
  return skipMarksDisagree(sourceSkip, kodikSkip) ? kodikSkip : sourceSkip;
}

/** Сколько процентов сосиски уже проиграно. */
export function sausagePlayedPct(s: TimelineSausage, progressPct: number): number {
  const end = s.startPct + s.widthPct;
  if (progressPct <= s.startPct) return 0;
  if (progressPct >= end) return 100;
  if (!(s.widthPct > 0)) return 0;
  return ((progressPct - s.startPct) / s.widthPct) * 100;
}

export interface TimelineRangePct {
  startPct: number;
  endPct: number;
}

/** Пересечение диапазона с сосиской — left/width в процентах самой сосиски. */
export function sausageRangeFill(
  s: TimelineSausage,
  fromPct: number,
  toPct: number,
): { leftPct: number; widthPct: number } | null {
  const end = s.startPct + s.widthPct;
  const a = Math.max(s.startPct, Math.min(fromPct, toPct));
  const b = Math.min(end, Math.max(fromPct, toPct));
  if (!(s.widthPct > 0) || b - a < 0.04) return null;
  return {
    leftPct: ((a - s.startPct) / s.widthPct) * 100,
    widthPct: ((b - a) / s.widthPct) * 100,
  };
}
