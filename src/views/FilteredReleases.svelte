<script lang="ts">
  /** Результаты поиска по фильтру (POST /filter/{page}), как FilteredFragment в Anixart. */
  import { onDestroy, onMount } from 'svelte';
  import DiscoverHero from '../components/DiscoverHero.svelte';
  import ReleaseCardsGrid from '../components/ReleaseCardsGrid.svelte';
  import ReleaseCardsGridSkeleton from '../components/ReleaseCardsGridSkeleton.svelte';
  import ReleaseFilterPanel from '../components/ReleaseFilterPanel.svelte';
  import UiV2ContentRetryOverlay from '../components/uikit-v2/UiV2ContentRetryOverlay.svelte';
  import { iconFilm } from '../components/icons';
  import type { ReleaseCardData } from '../types/release';
  import { headlineFromLoadError } from '../utils/content-load-error';
  import { toFilterRequest, type CustomFilterStorage } from '../utils/homeCustomTab';
  import { toIpcArgs } from '../utils/ipc-args';
  import { mapReleaseRawToCard } from '../utils/release-card';
  import { describeFilter, FILTER_SEARCH_EVENT, loadSearchFilter, saveSearchFilter } from '../utils/searchFilter';

  let filter = $state<CustomFilterStorage>(loadSearchFilter());
  let { embedded = false }: { embedded?: boolean } = $props();
  let filterRevision = $state(0);
  let items = $state<ReleaseCardData[]>([]);
  let page = 0;
  let hasMore = true;
  let isLoading = $state(false);
  let loadState = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');
  let errorMsg = $state('');
  /** Ответ на старый фильтр не должен попасть в новый список. */
  let requestSeq = 0;
  let wrapEl = $state<HTMLElement | undefined>();
  let scrollEl: HTMLElement | null = null;

  const summary = $derived(describeFilter(filter));

  async function loadPage() {
    if (isLoading || !hasMore || !window.anixApi) return;
    const seq = ++requestSeq;
    isLoading = true;
    const current = page;
    if (current === 0) loadState = 'loading';
    try {
      const data = await window.anixApi.release.filter(current, toIpcArgs(toFilterRequest(filter)), true) as { content?: Record<string, unknown>[] };
      if (seq !== requestSeq) return;
      const content = data?.content ?? [];
      if (!content.length) {
        hasMore = false;
        if (current === 0) loadState = 'empty';
        return;
      }
      items = [...items, ...content.map((row) => mapReleaseRawToCard(row))];
      page = current + 1;
      loadState = 'ready';
      requestAnimationFrame(checkIfNeedsMore);
    } catch (err) {
      if (seq === requestSeq && current === 0) {
        errorMsg = headlineFromLoadError(err);
        loadState = 'error';
      }
    } finally {
      if (seq === requestSeq) isLoading = false;
    }
  }

  function checkIfNeedsMore() {
    if (!scrollEl || !hasMore || isLoading) return;
    if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 300) void loadPage();
  }

  function restart() {
    requestSeq += 1;
    isLoading = false;
    items = [];
    page = 0;
    hasMore = true;
    if (scrollEl) scrollEl.scrollTop = 0;
    void loadPage();
  }

  function applyFilter(next: CustomFilterStorage) {
    filter = next;
    saveSearchFilter(filter);
    restart();
  }

  onMount(() => {
    scrollEl = wrapEl?.closest<HTMLElement>('.page__scroll') ?? document.getElementById('content');
    scrollEl?.addEventListener('scroll', checkIfNeedsMore, { passive: true });
    const refreshFilter = () => {
      filter = loadSearchFilter();
      filterRevision += 1;
      restart();
    };
    window.addEventListener(FILTER_SEARCH_EVENT, refreshFilter);
    void loadPage();
    return () => window.removeEventListener(FILTER_SEARCH_EVENT, refreshFilter);
  });

  onDestroy(() => {
    requestSeq += 1;
    scrollEl?.removeEventListener('scroll', checkIfNeedsMore);
  });
</script>

<div class="filtered-catalog" class:discover-page={!embedded} class:view={!embedded} bind:this={wrapEl}>
  {#if !embedded}
    <DiscoverHero title="Результаты фильтра" subtitle={summary || 'Все релизы'} />
  {/if}

  <div class="filtered-catalog__layout">
    <aside class="filtered-catalog__filters" aria-label="Фильтры каталога">
      {#key filterRevision}
        <ReleaseFilterPanel title="Фильтры" presentation="inline" gridLayout initial={filter} onApply={applyFilter} />
      {/key}
    </aside>

    <section class="filtered-catalog__results" aria-labelledby="filtered-catalog-heading">
      <h2 id="filtered-catalog-heading">Поиск</h2>

      {#if loadState === 'loading'}
        <div class="bookmarks__grid"><ReleaseCardsGridSkeleton /></div>
      {:else if loadState === 'error'}
        <UiV2ContentRetryOverlay message={errorMsg} onRetry={restart} />
      {:else if loadState === 'empty'}
        <div class="discover-empty">
          <span class="discover-empty__icon" aria-hidden="true">{@html iconFilm(26)}</span>
          <p class="discover-empty__title">Ничего не найдено</p>
          <p class="discover-empty__text">Попробуйте убрать часть условий</p>
        </div>
      {:else}
        <div class="bookmarks__grid"><ReleaseCardsGrid {items} /></div>
        {#if isLoading}
          <div class="bookmarks__grid"><ReleaseCardsGridSkeleton count={4} /></div>
        {/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .filtered-catalog__layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: clamp(0.75rem, 2vw, 1.5rem);
    align-items: start;
  }
  :global(html.mobile-mode) .filtered-catalog:not(.view) .filtered-catalog__filters {
    padding-inline: var(--m-gutter);
  }

  .filtered-catalog__results {
    min-width: 0;
  }
  :global(html.mobile-mode) .filtered-catalog:not(.view) .filtered-catalog__results > h2 {
    margin-inline: var(--m-gutter);
  }
  .filtered-catalog__results > h2 {
    margin: 0 0 0.6rem;
    font-size: 1rem;
    font-weight: 650;
  }
</style>
