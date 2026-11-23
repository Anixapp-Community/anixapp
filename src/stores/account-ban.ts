import { get, writable } from 'svelte/store';
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
export function isAccountBanActive(state: AccountBanState): boolean {
  if (!state.loaded) return false;
  if (state.permanent) return true;
  if (state.expires > 0) return state.expires * 1000 > Date.now();
  return state.active;
}

export function accountBanTitle(state: AccountBanState): string {
  if (state.permanent) return 'Аккаунт заблокирован навсегда';
  if (state.expires > 0) return `Аккаунт заблокирован до ${formatHistoryViewTime(state.expires)}`;
  return 'Аккаунт заблокирован';
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

      const permanent = !!profile.is_perm_banned;
      const expires = toSeconds(profile.ban_expires);
      const flagged = !!profile.is_banned;
      const active = permanent || flagged || expires * 1000 > Date.now();
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
  accountBan.set(EMPTY);
}
