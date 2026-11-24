<script lang="ts">
  import { CommentsSection } from '../../../components/comments';
  import { navigate } from '../../../stores/navigation';
  import { openCommentsPanel } from '../../../stores/comments-panel';
  import { isMobileMode } from '../../../platform/mobile';
  import { normalizeCommentsFromResponse } from '../../../utils/comment';
  import type { CommentData } from '../../../types/comment';

  interface Props {
    releaseId: number;
    comments: Record<string, unknown>[];
    totalCount?: number;
    /** Полный ответ API (для Jackson @id), если есть */
    commentsRoot?: Record<string, unknown> | null;
  }

  let { releaseId, comments, totalCount, commentsRoot = null }: Props = $props();

  let selfProfileId = $state<number | null>(null);
  let loadedItems = $state<CommentData[]>([]);
  let loading = $state(false);

  /**
   * «Показать всё»: на ПК комментарии открываются правой панелью поверх тайтла,
   * на телефоне — отдельной страницей (там панели нет).
   */
  function showAllComments() {
    if (isMobileMode()) {
      navigate(`/release/${releaseId}/comments`);
      return;
    }
    const title = String((commentsRoot?.title_ru ?? commentsRoot?.title_original ?? '') || '').trim();
    openCommentsPanel({ kind: 'release', id: releaseId, title });
  }

  $effect(() => {
    releaseId;
    const root = commentsRoot ?? { content: comments };
    const preview = normalizeCommentsFromResponse(root);

    if (preview.length > 0) {
      loadedItems = preview;
      return;
    }

    const count = totalCount ?? 0;
    if (!count || !window.anixApi?.comments?.release) {
      loadedItems = [];
      return;
    }

    let cancelled = false;
    loading = true;

    void window.anixApi.comments.release
      .list(releaseId, 0, 0)
      .then((data) => {
        if (cancelled) return;
        loadedItems = normalizeCommentsFromResponse(data as Record<string, unknown>);
      })
      .catch(() => {
        if (!cancelled) loadedItems = [];
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    releaseId;
    void window.anixApi?.profile?.self?.().then((data: { profile?: { id?: number } }) => {
      selfProfileId = data?.profile?.id ?? null;
    });
  });
</script>

{#if loading && loadedItems.length === 0}
  <section class="anix-comments release-page__section" id="comments">
    <header class="anix-comments__header">
      <div class="anix-comments__heading">
        <h2 class="anix-comments__title">
          Комментарии{totalCount ? ` (${totalCount})` : ''}
        </h2>
        <p class="anix-comments__subtitle">Популярные и актуальные</p>
      </div>
      <button
        type="button"
        class="anix-comments__show-all"
        onclick={showAllComments}
      >
        Показать всё
      </button>
    </header>
    <div class="anix-comments__empty">Загрузка…</div>
  </section>
{:else}
  <CommentsSection
    items={loadedItems}
    totalCount={totalCount ?? loadedItems.length}
    {releaseId}
    {selfProfileId}
    showComposer={true}
    onShowAll={showAllComments}
  />
{/if}
