import { get, writable } from 'svelte/store';
import { anixErrorCode } from '../native/anix-errors';
import { accountBan, noteAccountBan } from './account-ban';
import { formatHistoryViewTime } from '../utils/historyFormat';

/**
 * Диалоги блокировки — как AlertDialog в официальном приложении Anixart 11.
 * Тексты взяты из ресурсов APK (values/strings.xml), чтобы совпадать дословно.
 */
export type BanAlertKind =
  | 'comments'
  | 'votes'
  | 'collections'
  | 'blog'
  | 'loginHistory'
  | 'generic'
  | 'permanent';

export type BanAlert = {
  title: string;
  message: string;
  ok: string;
};

const TEXTS: Record<BanAlertKind, BanAlert> = {
  comments: {
    title: 'Ошибка',
    message:
      'Вы не можете оставлять комментарии в связи с нарушением правил. Подробную информацию вы можете найти на странице своего профиля.',
    ok: 'Ок',
  },
  votes: {
    title: 'Ошибка',
    message: 'Вы не можете голосовать, поскольку ваш аккаунт заблокирован',
    ok: 'Ок',
  },
  collections: {
    title: 'Ошибка',
    message:
      'Вы не можете создавать или редактировать коллекции в связи с нарушением правил. Подробную информацию вы можете найти на странице своего профиля.',
    ok: 'Ок',
  },
  blog: {
    title: 'Ошибка',
    message: 'Твой аккаунт заблокирован, улучшить профиль пока нельзя.',
    ok: 'Ок',
  },
  loginHistory: {
    title: 'Ошибка',
    message: 'Во время блокировки очистить историю нельзя',
    ok: 'Ок',
  },
  generic: {
    title: 'Ошибка',
    message: 'Что-то пошло не так, попробуйте позже',
    ok: 'Ок',
  },
  permanent: {
    title: 'Ошибка',
    message: 'Ваш аккаунт был заблокирован навсегда в связи с нарушением правил приложения.',
    ok: 'Понятно',
  },
};

export const banAlert = writable<BanAlert | null>(null);

/** Служебная ошибка: бан уже показан диалогом, обычный тост/сообщение не нужно. */
export class BanActionError extends Error {
  constructor() {
    super('banned');
    this.name = 'BanActionError';
  }
}

export function isBanActionError(err: unknown): boolean {
  return err instanceof BanActionError;
}

/** Показать диалог по типу запрещённого действия (как onBanned() в оригинале). */
export function showBanAlert(kind: BanAlertKind): void {
  banAlert.set(TEXTS[kind]);
}

export function showBanAlertText(alert: BanAlert): void {
  banAlert.set(alert);
}

/**
 * Банный диалог для запрещённого действия:
 * «Смена фото профиля недоступна: аккаунт заблокирован до 27 нояб. 23:00.»
 */
export function banActionAlert(action: string): BanAlert {
  const state = get(accountBan);
  const until = state.permanent
    ? 'навсегда'
    : state.expires > 0
      ? `до ${formatHistoryViewTime(state.expires)}`
      : '';
  return {
    title: 'Аккаунт заблокирован',
    message: until
      ? `${action} недоступна: аккаунт заблокирован ${until}.`
      : `${action} недоступна: аккаунт заблокирован.`,
    ok: 'Понятно',
  };
}

/** Ответ API на запрещённое действие: 402 — бан, 403 — бан навсегда. */
export function handleBanAction(code: number, action: string): boolean {
  if (code === 403) {
    noteAccountBan(403);
    showBanAlert('permanent');
    return true;
  }
  if (code === 402) {
    noteAccountBan(402);
    showBanAlertText(banActionAlert(action));
    return true;
  }
  return false;
}

export function handleBanActionError(err: unknown, action: string): boolean {
  const code = anixErrorCode(err) ?? httpCode(err);
  if (code == null) return false;
  return handleBanAction(code, action);
}

export function closeBanAlert(): void {
  banAlert.set(null);
}

/**
 * Ответ API с кодом бана: 402 — действие запрещено забаненному, 403 — бан навсегда.
 * `true` — код относится к блокировке, диалог уже показан.
 */
export function handleBanCode(code: number, kind: BanAlertKind): boolean {
  if (code === 402 || code === 403) noteAccountBan(code);
  if (code === 403) {
    showBanAlert('permanent');
    return true;
  }
  if (code === 402) {
    showBanAlert(kind);
    return true;
  }
  return false;
}

/** То же для ошибки-исключения: достаём код Anixart из err.code / err.status. */
export function handleBanError(err: unknown, kind: BanAlertKind): boolean {
  const code = anixErrorCode(err) ?? httpCode(err);
  if (code == null) return false;
  return handleBanCode(code, kind);
}

function httpCode(err: unknown): number | null {
  if (err == null || typeof err !== 'object') return null;
  const rec = err as { status?: unknown; httpStatus?: unknown };
  for (const raw of [rec.status, rec.httpStatus]) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Текущее значение — для отладки/тестов. */
export function currentBanAlert(): BanAlert | null {
  return get(banAlert);
}
