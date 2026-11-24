<script lang="ts">
  import { onMount } from 'svelte';
  import CommentsSection from './comments/CommentsSection.svelte';
  import CommentsSortField from './comments/CommentsSortField.svelte';
  import UiV2RoundButton from './uikit-v2/UiV2RoundButton.svelte';
  import UiV2Button from './uikit-v2/UiV2Button.svelte';
  import UiV2CommentThreadSkeleton from './uikit-v2/UiV2CommentThreadSkeleton.svelte';
  import { iconX } from './icons';
  import { closeCommentsPanel, type CommentsPanelTarget } from '../stores/comments-panel';
  import { formatCommentsTotal, normalizeCommentsFromResponse } from '../utils/comment';
  import { headlineFromLoadError } from '../utils/content-load-error';
  import type { CommentData, CommentSort } from '../types/comment';
  import { COMMENT_SORT_DEFAULT } from '../types/comment';

  interface Props {
    target: CommentsPanelTarget;
  }

  let { target }: Props = $props();

  type LoadState = 'loading' | 'ready' | 'error';

  let loadState = $state<LoadState>('loading');
  let errorMsg = $state('');
  let items = $state<CommentData[]>([]);
  let totalCount = $state(0);
  let page = $state(0);
  let hasMore = $state(false);
  let loadingMore = $state(false);
  let sort = $state<CommentSort>(COMMENT_SORT_DEFAULT);
  let selfProfileId = $state<number | null>(null);
  let title = $state(target.title ?? '');

  const commentsApi = () =>
    target.kind === 'collection'
      ? window.anixApi?.comments?.collection
      : window.anixApi?.comments?.release;

  async function loadPage(nextPage: number, append = false) {
    const api = commentsApi();
    if (!api?.list) {
      loadState = 'error';
      errorMsg = 'API недоступен';
      return;
    }

    if (append) loadingMore = true;
    else if (nextPage === 0 && loadState !== 'error') loadState = 'loading';

    try {
      const data = await api.list(target.id, nextPage, sort) as {
        content?: Record<string, unknown>[];
        total_count?: number;
        total_elements?: number;
        last?: boolean;
      };

      const chunk = normalizeCommentsFromResponse(data as Record<string, unknown>);
      items = append ? [...items, ...chunk] : chunk;
      totalCount = data.total_count ?? data.total_elements ?? items.length;
      hasMore = data.last === false || (chunk.length > 0 && items.length < totalCount);
      page = nextPage;
      loadState = 'ready';
    } catch (err) {
      if (!append) {
        loadState = 'error';
        errorMsg = headlineFromLoadError(err);
      }
    } finally {
      loadingMore = false;
    }
  }

  function handleSortChange(next: CommentSort) {
    if (next === sort) return;
    sort = next;
    void loadPage(0);
  }

  function loadMore() {
    if (!hasMore || loadingMore) return;
    void loadPage(page + 1, true);
  }

  /** Заголовок тайтла/коллекции для шапки панели. */
  async function loadTitle() {
    try {
      if (target.kind === 'collection') {
        const data = await window.anixApi?.collection?.info?.(target.id) as
          | { collection?: { title?: string } }
          | undefined;
        const next = (data?.collection?.title ?? '').trim();
        if (next) title = next;
        return;
      }
      const data = await window.anixApi?.release?.info?.(target.id, false) as
        | { release?: { title_ru?: string; title_original?: string } }
        | undefined;
      const next = (data?.release?.title_ru || data?.release?.title_original || '').trim();
      if (next) title = next;
    } catch {
      /* без подзаголовка панель всё равно работает */
    }
  }

  onMount(() => {
    const selfPromise = window.anixApi?.profile?.self?.();
    if (selfPromise) {
      void selfPromise
        .then((data: { profile?: { id?: number } }) => {
          selfProfileId = data?.profile?.id ?? null;
        })
        .catch(() => {});
    }
    if (!title) void loadTitle();
    void loadPage(0);
  });
</script>

<div class="comments-panel" role="dialog" aria-label="Комментарии">
  <header class="comments-panel__head">
    <div class="comments-panel__heading">
      <h2 class="comments-panel__title">Комментарии</h2>
      {#if title}
        <p class="comments-panel__subject">{title}</p>
      {/if}
    </div>
    <UiV2RoundButton size="md" label="Закрыть" class="comments-panel__close" onclick={closeCommentsPanel}>
      {@html iconX(18)}
    </UiV2RoundButton>
  </header>

  {#if loadState === 'loading' || (loadState === 'ready' && totalCount > 0)}
    <div class="comments-panel__tools">
      <span class="comments-panel__count">
        {#if loadState === 'ready'}{formatCommentsTotal(totalCount)}{/if}
      </span>
      <CommentsSortField {sort} onSortChange={handleSortChange} />
    </div>
  {/if}

  <div class="comments-panel__body">
    {#if loadState === 'loading' && items.length === 0}
      <div class="comments-panel__state">
        <UiV2CommentThreadSkeleton count={4} />
      </div>
    {:else if loadState === 'error'}
      <div class="comments-panel__state comments-panel__state--error">
        <p class="comments-panel__state-text">{errorMsg || 'Не удалось загрузить комментарии'}</p>
        <UiV2Button label="Повторить" variant="chrome" size="sm" onclick={() => void loadPage(0)} />
      </div>
    {:else}
      <CommentsSection
        title=""
        subtitle=""
        {items}
        totalCount={totalCount}
        releaseId={target.kind === 'release' ? target.id : undefined}
        collectionId={target.kind === 'collection' ? target.id : undefined}
        mode="full"
        showComposer={true}
        composerDock={true}
        asSection={false}
        domId="comments-panel"
        customScroll={true}
        {selfProfileId}
        initialReplyId={target.replyId ?? null}
        loadMore={{
          hasMore,
          loading: loadingMore,
          onLoad: loadMore,
        }}
        onItemsChange={(next) => { items = next; }}
        onCommentAdded={() => { totalCount += 1; }}
      />
    {/if}
  </div>
</div>
