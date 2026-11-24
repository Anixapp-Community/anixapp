import { get, readable, writable } from 'svelte/store';
import { formatHistoryViewTime } from '../utils/historyFormat';

/**
 * Состояние блокировки текущего аккаунта — как «Профиль. Аккаунт заблокирован» в Anixart.
 * Один запрос `profile/self` на всех экранах: бейдж на аватаре и подсказки ограничений.
 */
export type AccountBanState = {
  loaded: boolean;
  /** Сервер помечает аккаунт как забаненный (is_banned) */
  active: boolean;
  permanent: boolean;
  /** Unix-время окончания бана (секунды), 0 — бессрочно/нет */
  expires: number;
  reason: string;
  checkedAt: number;
};

const EMPTY: AccountBanState = {
  loaded: false,
  active: false,
  permanent: false,
  expires: 0,
  reason: '',
  checkedAt: 0,
};

const CACHE_TTL_MS = 60_000;

export const accountBan = writable<AccountBanState>(EMPTY);

let inflight: Promise<AccountBanState> | null = null;

function toSeconds(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

/** Активна ли блокировка прямо сейчас (учитывает срок, даже если сервер ещё не снял флаг). */
export function isAccountBanActive(state: AccountBanState, now = Date.now()): boolean {
  if (!state.loaded) return false;
  if (state.permanent) return true;
  if (state.expires > 0) return state.expires * 1000 > now;
  return state.active;
}

/**
 * Сколько осталось до снятия блокировки, мс.
 * `0` — бана нет, `Infinity` — бессрочный бан или срок неизвестен.
 */
export function accountBanRemainingMs(state: AccountBanState, now = Date.now()): number {
  if (!isAccountBanActive(state, now)) return 0;
  if (state.permanent) return Number.POSITIVE_INFINITY;
  if (state.expires > 0) return Math.max(0, state.expires * 1000 - now);
  return Number.POSITIVE_INFINITY;
}

/** Короткая подпись для бейджа рядом с аватаром: «ещё 3 д. 4 ч.», «бессрочно». */
export function accountBanRemainingLabel(state: AccountBanState, now = Date.now()): string {
  const left = accountBanRemainingMs(state, now);
  if (left === 0) return '';
  if (!Number.isFinite(left)) {
    return state.permanent ? 'бессрочно' : 'заблокирован';
  }

  const totalMin = Math.max(1, Math.ceil(left / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days >= 1) return hours > 0 ? `ещё ${days} д. ${hours} ч.` : `ещё ${days} д.`;
  if (hours >= 1) return mins > 0 ? `ещё ${hours} ч. ${mins} мин.` : `ещё ${hours} ч.`;
  return mins > 1 ? `ещё ${mins} мин.` : 'меньше минуты';
}

export function accountBanTitle(state: AccountBanState): string {
  if (state.permanent) return 'Аккаунт заблокирован навсегда';
  if (state.expires > 0) return `Аккаунт заблокирован до ${formatHistoryViewTime(state.expires)}`;
  return 'Аккаунт заблокирован';
}

/** Подсказка бейджа: срок окончания и остаток. */
export function accountBanTooltip(state: AccountBanState, now = Date.now()): string {
  const title = accountBanTitle(state);
  const left = accountBanRemainingLabel(state, now);
  return left ? `${title} · ${left}` : title;
}

/**
 * Тикающие «сейчас» для интерфейса: бан истекает по времени, поэтому подписи и
 * заблокированные кнопки должны пересчитываться сами, без перезапуска.
 * Один интервал на всех подписчиков.
 */
export const banClock = readable(Date.now(), (set) => {
  const id = setInterval(() => set(Date.now()), 30_000);
  return () => clearInterval(id);
});

/**
 * Сервер ответил 402/403 — аккаунт точно заблокирован, даже если profile/self
 * ещё не вернул флаги (или кэш старый). Держим это до явного «бана нет» от сервера.
 */
let serverBanCode = 0;

export function noteAccountBan(code: number): void {
  if (code !== 402 && code !== 403) return;
  serverBanCode = code;
  accountBan.update((state) => ({
    ...state,
    loaded: true,
    active: true,
    permanent: state.permanent || code === 403,
    checkedAt: 0,
  }));
  void refreshAccountBan(true);
}

export async function refreshAccountBan(force = false): Promise<AccountBanState> {
  const current = get(accountBan);
  if (!force && current.loaded && Date.now() - current.checkedAt < CACHE_TTL_MS) return current;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const api = window.anixApi?.profile;
      if (!api?.self) return get(accountBan);

      const res = (await api.self()) as Record<string, unknown> | undefined;
      const profile = (res?.profile ?? res ?? {}) as Record<string, unknown>;
      if (!profile || typeof profile !== 'object' || !('id' in profile)) return get(accountBan);

      const permanent = !!profile.is_perm_banned || serverBanCode === 403;
      const expires = toSeconds(profile.ban_expires);
      const flagged = !!profile.is_banned;
      // Снимаем серверную отметку только если профиль явно говорит «бана нет».
      const hasBanFields = 'is_banned' in profile || 'ban_expires' in profile || 'is_perm_banned' in profile;
      if (hasBanFields && !permanent && !flagged && expires * 1000 <= Date.now()) {
        serverBanCode = 0;
      }
      const active = permanent || flagged || expires * 1000 > Date.now() || serverBanCode > 0;
      const next: AccountBanState = {
        loaded: true,
        active,
        permanent,
        expires: permanent ? 0 : expires,
        reason: String(profile.ban_reason ?? '').trim(),
        checkedAt: Date.now(),
      };
      accountBan.set(next);
      return next;
    } catch {
      // Нет сети/токена — не показываем ложный бан, просто отметим проверку.
      accountBan.update((state) => ({ ...state, checkedAt: Date.now() }));
      return get(accountBan);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Сбросить состояние при выходе из аккаунта. */
export function resetAccountBan(): void {
  serverBanCode = 0;
  accountBan.set(EMPTY);
}
