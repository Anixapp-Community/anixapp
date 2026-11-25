/** Поиск по фильтру (как FilterFragment в Anixart): последний фильтр хранится на устройстве. */
import { AGE_RATINGS, CATEGORIES, EPISODE_DURATIONS, EPISODES_PRESETS, SEASONS, STATUSES } from '../data/filterOptions';
import {
  DEFAULT_CUSTOM_FILTER,
  GENRES_MODE_ANY,
  GENRES_MODE_EXCLUDE,
  normalizeFilter,
  toFilterRequest,
  type CustomFilterStorage,
} from './homeCustomTab';

import { isCurrentAppRoute, navigate } from '../stores/navigation';

export const FILTER_SEARCH_EVENT = 'anix:filter-search';

export function openFilteredResults(): void {
  if (isCurrentAppRoute('/filtered')) window.dispatchEvent(new Event(FILTER_SEARCH_EVENT));
  else navigate('/filtered');
}

const STORAGE_KEY = 'anixapp.search.filter';

export function loadSearchFilter(): CustomFilterStorage {
  try {
    return normalizeFilter(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) ?? { ...DEFAULT_CUSTOM_FILTER };
  } catch {
    return { ...DEFAULT_CUSTOM_FILTER };
  }
}

export function saveSearchFilter(filter: CustomFilterStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch { /* приватный режим: фильтр проживёт до перезагрузки в самом экране */ }
}

function labelOf(rows: readonly { id: number; label: string }[], id: number | null): string {
  return rows.find((row) => row.id === id)?.label ?? '';
}

/** Подпись выбранного: «Сериал · 2020 – 2024 · Кроме: драма». */
export function describeFilter(f: CustomFilterStorage): string {
  const years = f.selected_start_year != null && f.selected_end_year != null
    ? `${f.selected_start_year} – ${f.selected_end_year}`
    : f.selected_start_year != null
      ? `с ${f.selected_start_year}`
      : f.selected_end_year != null
        ? `до ${f.selected_end_year}`
        : '';
  const genres = f.selected_genres.join(', ');
  const genresText = !genres
    ? ''
    : f.selected_genres_mode === GENRES_MODE_EXCLUDE
      ? `Кроме: ${genres}`
      : f.selected_genres_mode === GENRES_MODE_ANY
        ? `Любой из: ${genres}`
        : genres;
  const ages = f.selected_age_ratings
    .map((id) => AGE_RATINGS.find((row) => String(row.id) === id)?.label ?? '')
    .join(', ');
  return [
    labelOf(CATEGORIES, f.selected_category_id),
    labelOf(STATUSES, f.selected_status_id),
    genresText,
    years,
    labelOf(SEASONS, f.selected_season),
    f.selected_country,
    f.selected_studio,
    f.selected_source,
    labelOf(EPISODES_PRESETS, f.selected_episodes),
    labelOf(EPISODE_DURATIONS, f.selected_episode_duration),
    ages,
  ].filter(Boolean).join(' · ');
}

type SearchRelease = Record<string, unknown>;

function searchTokens(value: unknown): string[] {
  const name = (item: unknown) => item && typeof item === 'object' ? (item as { name?: string }).name : item;
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(name(item) ?? '').toLocaleLowerCase('ru').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function matchesSearchRelease(raw: SearchRelease, filter: CustomFilterStorage): boolean {
  const args = toFilterRequest(filter);
  const category = raw.category_id ?? (raw.category as { id?: number } | undefined)?.id ?? CATEGORIES.find((item) => item.label === raw.category)?.id;
  const numbers = [
    [category, args.category_id],
    [raw.status_id ?? (raw.status as { id?: number } | undefined)?.id, args.status_id],
    [raw.season, args.season],
  ];
  if (numbers.some(([actual, expected]) => expected != null && Number(actual) !== expected)) return false;

  const ranges = [
    [raw.year, args.start_year, args.end_year],
    [Number(raw.episodes_total) > 0 ? raw.episodes_total : raw.episodes_released, args.episodes_from, args.episodes_to],
    [raw.duration ?? raw.episode_duration, args.episode_duration_from, args.episode_duration_to],
  ];
  if (ranges.some(([actual, min, max]) => (min != null || max != null) &&
    (actual == null || !Number.isFinite(Number(actual)) ||
      (min != null && Number(actual) < Number(min)) || (max != null && Number(actual) > Number(max))))) return false;

  const text = [
    [raw.country, filter.selected_country],
    [raw.studio, filter.selected_studio],
    [raw.source, filter.selected_source],
  ];
  if (text.some(([actual, expected]) => expected && !searchTokens(actual).includes(String(expected).trim().toLocaleLowerCase('ru')))) return false;

  if (filter.selected_age_ratings.length && !filter.selected_age_ratings.includes(String(raw.age_rating))) return false;
  if (filter.selected_profile_list_exclusions.includes(String(raw.profile_list_status))) return false;

  const genres = searchTokens(raw.genres);
  const matches = filter.selected_genres.map((genre) => genres.includes(genre.toLocaleLowerCase('ru')));
  if (!matches.length) return true;
  if (filter.selected_genres_mode === GENRES_MODE_EXCLUDE) return !matches.some(Boolean);
  if (filter.selected_genres_mode === GENRES_MODE_ANY) return matches.some(Boolean);
  return matches.every(Boolean);
}
