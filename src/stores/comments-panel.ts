import { get, writable } from 'svelte/store';

/**
 * Правая панель комментариев (как расписание и профиль).
 * Открывается с «Показать всё» на странице тайтла/коллекции вместо отдельной страницы.
 */
export type CommentsPanelKind = 'release' | 'collection';

export type CommentsPanelTarget = {
  kind: CommentsPanelKind;
  id: number;
  /** Заголовок, если он уже известен; иначе панель подгрузит его сама. */
  title?: string;
  /** Комментарий, на который нужно сразу ответить (deep link `?reply=`). */
  replyId?: number | null;
};

export const commentsPanelOpen = writable(false);
export const commentsPanelTarget = writable<CommentsPanelTarget | null>(null);

export function openCommentsPanel(target: CommentsPanelTarget): void {
  const id = Math.trunc(Number(target.id));
  if (!Number.isFinite(id) || id <= 0) return;

  const replyId = Math.trunc(Number(target.replyId));
  commentsPanelTarget.set({
    kind: target.kind === 'collection' ? 'collection' : 'release',
    id,
    title: target.title?.trim() || undefined,
    replyId: Number.isFinite(replyId) && replyId > 0 ? replyId : null,
  });
  commentsPanelOpen.set(true);
}

export function closeCommentsPanel(): void {
  if (!get(commentsPanelOpen)) return;
  commentsPanelOpen.set(false);
}

export function isCommentsPanelOpen(): boolean {
  return get(commentsPanelOpen);
}

/**
 * Переход на другую страницу из открытой панели закрывает её — как панель профиля.
 * `replace` не считаем сменой страницы: так панель открывается по прямому адресу
 * `/release/:id/comments`, когда адрес тут же нормализуется до страницы тайтла.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('anix:beforeNavigate', (e) => {
    const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
    if (kind === 'push') closeCommentsPanel();
  });
}
