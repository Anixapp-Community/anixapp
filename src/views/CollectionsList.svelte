<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import CollectionCard from '../components/CollectionCard.svelte';
  import type { CollectionCardData } from '../components/CollectionCard.svelte';
  import UiV2CollectionCardSkeleton from '../components/uikit-v2/UiV2CollectionCardSkeleton.svelte';
  import DiscoverHero from '../components/DiscoverHero.svelte';
  import UiV2Button from '../components/uikit-v2/UiV2Button.svelte';
  import UiV2SectionHeader from '../components/uikit-v2/UiV2SectionHeader.svelte';
  import UiV2ReleaseCarousel from '../components/uikit-v2/UiV2ReleaseCarousel.svelte';
  import UiV2PopupMenu, { type UiV2PopupMenuItem } from '../components/uikit-v2/UiV2PopupMenu.svelte';
  import UiV2PillField from '../components/uikit-v2/UiV2PillField.svelte';
  import UiV2ContentRetryOverlay from '../components/uikit-v2/UiV2ContentRetryOverlay.svelte';
  import {
    iconArrowUpDown,
    iconChevronDown,
    iconLayoutGrid,
    iconPlus,
    iconSearch,
    iconX,
  } from '../components/icons';
  import { navigate } from '../stores/navigation';
  import { isAuthenticated, requireAuth } from '../stores/auth';
  import { ensureProfileId } from '../utils/profile';
  import { resolveJacksonRefs } from '../utils/jackson-refs';
  import { buildPosterUrl } from '../utils/posterUrl';
  import { openProfilePanel } from '../stores/profile-panel';
  import { closeLocalSearch, localSearchLabel, localSearchQuery } from '../stores/mobile-local-search';
  import { isMobileMode } from '../platform/mobile';
  import { headlineFromLoadError } from '../utils/content-load-error';
  import {
    COLLECTION_HUB_SORT_OPTIONS,
    collectionHubSortLabel,
    defaultCollectionHubSort,
    initialCollectionListPage,
    initialCollectionPreviousPage,
    clearCollectionEditorDraft,
    mapCollectionCard,
  } from '../utils/collection';
  import {
    buildViewStateKey,
    getViewState,
    saveViewStateData,
    restoreScrollTop,
    resetScrollTop,
    registerActiveScrollKey,
  } from '../stores/view-state';

  interface CollectionsViewState {
    items: CollectionCardData[];
    page: number;
    previousPage: number;
    hasMore: boolean;
    loadState: 'loading' | 'error' | 'empty' | 'ready';
    errorMsg: string;
    selectedSort: number;
    totalCount: number | null;
  }

  interface Props {
    week?: boolean;
    /** Режим «Мои» (/collections/my) — коллекции своего профиля */
    mine?: boolean;
    /** Коллекции другого пользователя (/profile/:id/collections) */
    userId?: number | null;
  }

  let { week = false, mine = false, userId = null }: Props = $props();

  /** Чужой профиль: шапка с аватаром и ником, без «Создать» */
  const foreign = $derived(userId != null && userId > 0);
  type Mode = 'hub' | 'week' | 'mine' | 'foreign';
  const mode = $derived<Mode>(week ? 'week' : foreign ? 'foreign' : mine ? 'mine' : 'hub');

  let ownerLogin = $state('');
  let ownerAvatar = $state('');
  let ownerTotal = $state<number | null>(null);

  let items = $state<CollectionCardData[]>([]);
  let page = $state(0);
  let previousPage = $state(-1);
  let hasMore = $state(true);
  let isLoading = $state(false);
  let loadState = $state<'loading' | 'error' | 'empty' | 'ready'>('loading');
  let errorMsg = $state('');
  let totalCount = $state<number | null>(null);
  let selectedSort = $state(defaultCollectionHubSort());
  let profileId: number | null = null;
  /** Растёт при каждом сбросе списка — ответы устаревших запросов отбрасываются */
  let loadToken = 0;

  // ——— Хаб: подборки недели, «созданные вами», «под ваш вкус» ———
  let hubWeekly = $state<CollectionCardData[]>([]);
  let hubMine = $state<CollectionCardData[]>([]);
  let hubRecommended = $state<CollectionCardData[]>([]);
  let hubState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let hubToken = 0;

  let sortOpen = $state(false);
  let sortBtn = $state<HTMLButtonElement | null>(null);

  const sortItems = $derived<UiV2PopupMenuItem[]>(
    COLLECTION_HUB_SORT_OPTIONS.map((o) => ({
      id: String(o.value),
      label: o.label,
      type: 'radio',
      checked: selectedSort === o.value,
    })),
  );

  const isHub = $derived(mode === 'hub');
  const showHubSections = $derived(isHub && $isAuthenticated);
  const sortLabel = $derived(collectionHubSortLabel(selectedSort));

  const listSort = $derived(week ? 4 : selectedSort);
  const listWhere = $derived(week ? 2 : 1);

  const pageTitle = $derived(week ? 'Коллекции недели' : 'Коллекции');
  const pageSubtitle = $derived(
    week
      ? 'Лучшие подборки за неделю'
      : foreign
        ? (ownerTotal != null ? collectionsCountLabel(ownerTotal) : '')
        : '',
  );

  const totalLabel = $derived(totalCount != null ? `${formatTotal(totalCount)} всего` : '');

  const skeletonCount = $derived(mode === 'foreign' || mode === 'mine' ? 4 : 6);

  /** Поиск по коллекциям пользователя: у API его нет — фильтруем загруженное (и догружаем всё при вводе) */
  let deskQuery = $state('');
  const searchQuery = $derived((isMobileMode() ? $localSearchQuery : deskQuery).trim().toLowerCase());
  const visibleItems = $derived(
    foreign && searchQuery
      ? items.filter((it) => `${it.title ?? ''} ${it.description ?? ''}`.toLowerCase().includes(searchQuery))
      : items,
  );

  function collectionsCountLabel(n: number): string {
    const m10 = n % 10;
    const m100 = n % 100;
    const word = m10 === 1 && m100 !== 11 ? 'коллекция'
      : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'коллекции'
        : 'коллекций';
    return `${formatTotal(n)} ${word}`;
  }

  /** 2 462 — как в приложении: разряды через пробел */
  function formatTotal(n: number): string {
    return new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.floor(n))).replace(/\u00a0/g, ' ');
  }

  let wrapEl: HTMLElement | undefined = $state();
  let scrollEl: HTMLElement | null = null;
  let scrollListener: (() => void) | null = null;
  let unregisterScrollKey: (() => void) | null = null;

  function viewKey(): string {
    if (mode === 'foreign') return buildViewStateKey(`/profile/${userId}/collections`);
    if (mode === 'mine') return buildViewStateKey('/collections/my');
    return buildViewStateKey('/collections');
  }

  $effect(() => {
    if (!foreign) return;
    localSearchLabel.set(ownerLogin ? `Поиск в коллекциях у ${ownerLogin}` : 'Поиск в коллекциях');
  });
  $effect(() => {
    // Ищем по всем коллекциям, а не по первой странице
    if (foreign && searchQuery && hasMore && !isLoading && loadState === 'ready') {
      void untrack(() => loadPage());
    }
  });

  /** Хаб грузим один раз, когда известна авторизация */
  $effect(() => {
    if (mode !== 'hub' || !$isAuthenticated) return;
    if (hubState !== 'idle') return;
    untrack(() => void loadHub());
  });

  async function loadHub() {
    if (hubState === 'loading' || hubState === 'ready') return;
    hubState = 'loading';
    const token = ++hubToken;
    const api = window.anixApi;
    if (!api) {
      hubState = 'error';
      return;
    }
    // Старый мост (до Anixart 11 BETA 3) канала не знает — собираем секции из доступных запросов
    if (typeof api.collection?.hub !== 'function') {
      await loadHubFallback();
      if (token === hubToken) hubState = 'ready';
      return;
    }
    try {
      const data = await api.collection.hub();
      if (token !== hubToken) return;
      if (data?.code != null && data.code !== 0) {
        await loadHubFallback();
        if (token === hubToken) hubState = 'ready';
        return;
      }
      const toCards = (list: unknown[] | undefined) =>
        (list ?? []).map((raw) => mapCollectionCard(raw as Record<string, unknown>));
      hubWeekly = toCards(data.weekly);
      hubMine = toCards(data.my);
      hubRecommended = toCards(data.recommended);
      hubState = 'ready';
    } catch {
      if (token !== hubToken) return;
      await loadHubFallback();
      if (token === hubToken) hubState = 'ready';
    }
  }

  /**
   * Запасной путь для сборок, где GET collection/hub ещё нет:
   * «Популярные за неделю» — discover/collectionsWeek, «Созданные вами» — коллекции профиля.
   * «Под ваш вкус» строится только сервером, поэтому в этом режиме секции нет.
   */
  async function loadHubFallback() {
    const api = window.anixApi;
    if (!api) return;
    const toCards = (list: unknown[] | undefined) =>
      (list ?? []).map((raw) => mapCollectionCard(raw as Record<string, unknown>));
    await Promise.all([
      (async () => {
        if (!api.discover?.collectionsWeek) return;
        try {
          const data = await api.discover.collectionsWeek(-1, 0);
          hubWeekly = toCards(data?.content);
        } catch {
          /* секция просто не покажется */
        }
      })(),
      (async () => {
        if (!api.collection?.profileCollections) return;
        try {
          if (profileId == null) profileId = await ensureProfileId();
          if (!profileId) return;
          const data = await api.collection.profileCollections(profileId, 0);
          hubMine = toCards(data?.content);
        } catch {
          /* секция просто не покажется */
        }
      })(),
    ]);
  }

  async function loadOwner(id: number) {
    try {
      const info = resolveJacksonRefs(await window.anixApi?.profile.info(id) as Record<string, unknown>);
      const p = info?.profile as { login?: string; avatar?: string } | undefined;
      ownerLogin = p?.login ?? '';
      ownerAvatar = p?.avatar ? buildPosterUrl(p.avatar) : '';
    } catch {
      /* шапка без ника — не критично */
    }
  }

  function snapshot(): CollectionsViewState {
    return { items, page, previousPage, hasMore, loadState, errorMsg, selectedSort, totalCount };
  }

  function applySnapshot(s: CollectionsViewState) {
    selectedSort = s.selectedSort;
    items = s.items;
    page = s.page;
    previousPage = s.previousPage;
    hasMore = s.hasMore;
    loadState = s.loadState;
    errorMsg = s.errorMsg;
    totalCount = s.totalCount ?? null;
  }

  function resetList() {
    loadToken += 1;
    isLoading = false;
    items = [];
    page = mode === 'mine' || mode === 'foreign' ? 0 : initialCollectionListPage(listSort);
    previousPage = initialCollectionPreviousPage();
    hasMore = true;
    loadState = 'loading';
  }

  function onSortChange(sort: number) {
    if (sort === selectedSort) return;
    selectedSort = sort;
    resetScrollTop();
    resetList();
    void loadPage();
  }

  /** Повтор после ошибки: сбрасываем «конец списка», иначе loadPage сразу выйдет */
  function retryLoad() {
    if (isLoading) return;
    hasMore = true;
    loadState = 'loading';
    void loadPage();
  }

  function createCollection() {
    if (!requireAuth()) return;
    clearCollectionEditorDraft();
    navigate('/collections/create');
  }

  function showAllMine() {
    if (!requireAuth()) return;
    navigate('/collections/my');
  }

  async function loadMinePage(token: number) {
    if (!window.anixApi?.collection?.profileCollections) return;
    if (foreign) profileId = userId;
    else if (profileId == null) profileId = await ensureProfileId();
    if (token !== loadToken) return;
    if (profileId == null) {
      errorMsg = 'Не удалось определить профиль';
      loadState = 'error';
      return;
    }
    const nextPage = page;
    const data = (await window.anixApi.collection.profileCollections(profileId, nextPage)) as {
      content?: unknown[];
      last?: boolean;
      total_count?: number;
    };
    if (token !== loadToken) return;
    if (nextPage === 0 && typeof data?.total_count === 'number') {
      ownerTotal = data.total_count;
      totalCount = data.total_count;
    }
    const content = (data?.content ?? []) as Record<string, unknown>[];
    if (!content.length) {
      hasMore = false;
      if (items.length === 0) loadState = 'empty';
      return;
    }
    items = [...items, ...content.map(mapCollectionCard)];
    page = nextPage + 1;
    if (data.last === true || content.length < 25) hasMore = false;
    loadState = 'ready';
    requestAnimationFrame(checkIfNeedsMore);
  }

  async function loadPage() {
    if (isLoading || !hasMore) return;
    if (mode === 'mine' || mode === 'foreign') {
      const token = loadToken;
      isLoading = true;
      try {
        await loadMinePage(token);
      } catch (err) {
        if (token === loadToken && items.length === 0) {
          errorMsg = headlineFromLoadError(err);
          loadState = 'error';
        }
      } finally {
        if (token === loadToken) isLoading = false;
      }
      return;
    }
    if (!window.anixApi?.collection?.all) return;

    const token = loadToken;
    isLoading = true;
    const nextPage = page;
    if (
      nextPage === initialCollectionListPage(listSort)
      && previousPage === initialCollectionPreviousPage()
      && items.length === 0
      && loadState !== 'error'
    ) {
      loadState = 'loading';
    }

    try {
      const requestPage = page;
      const requestPreviousPage = previousPage;
      const data = (await window.anixApi.collection.all(requestPage, {
        sort: listSort,
        where: listWhere,
        previousPage: requestPreviousPage,
      })) as {
        content?: unknown[];
        last?: boolean;
        total_page_count?: number;
        current_page?: number;
        total_count?: number;
        code?: number;
      };
      if (token !== loadToken) return;
      const content = (data?.content ?? []) as Record<string, unknown>[];
      if (data?.code != null && data.code !== 0) {
        hasMore = false;
        if (items.length === 0) {
          errorMsg = `Ошибка API (код ${data.code})`;
          loadState = 'error';
        }
        return;
      }
      if (typeof data.total_count === 'number') totalCount = data.total_count;
      if (!content.length) {
        hasMore = false;
        if (items.length === 0) loadState = 'empty';
        return;
      }
      items = [...items, ...content.map(mapCollectionCard)];
      previousPage = requestPage;
      page = requestPage + 1;
      const totalPages = typeof data.total_page_count === 'number' ? data.total_page_count : null;
      const currentPage = typeof data.current_page === 'number' ? data.current_page : requestPage;
      if (data.last === true) {
        hasMore = false;
      } else if (totalPages != null) {
        hasMore = currentPage + 1 < totalPages;
      } else {
        hasMore = content.length >= 25;
      }
      loadState = 'ready';
      requestAnimationFrame(checkIfNeedsMore);
    } catch (err) {
      if (token === loadToken && items.length === 0) {
        errorMsg = headlineFromLoadError(err);
        loadState = 'error';
      }
    } finally {
      if (token === loadToken) isLoading = false;
    }
  }

  function checkIfNeedsMore() {
    if (!scrollEl || !hasMore || isLoading) return;
    const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (distance < 300) void loadPage();
  }

  function attachScroll() {
    const el = (wrapEl?.closest('.page__scroll') as HTMLElement | null)
      ?? document.getElementById('content');
    if (!el) return;
    scrollEl = el;
    scrollListener = () => checkIfNeedsMore();
    el.addEventListener('scroll', scrollListener);
  }

  function detachScroll() {
    if (scrollEl && scrollListener) scrollEl.removeEventListener('scroll', scrollListener);
    scrollEl = null;
    scrollListener = null;
  }

  onMount(() => {
    unregisterScrollKey = registerActiveScrollKey(() => viewKey());
    if (foreign && userId) void loadOwner(userId);
    if (foreign) closeLocalSearch();

    const cached = mode === 'hub' || mode === 'week' ? getViewState<CollectionsViewState>(viewKey()) : null;
    if (cached?.data && cached.data.items.length > 0) {
      applySnapshot(cached.data);
      requestAnimationFrame(() => {
        attachScroll();
        void restoreScrollTop(cached.scrollTop, { maxWaitMs: 5000 });
      });
      return;
    }

    selectedSort = mode === 'week' ? 4 : defaultCollectionHubSort();
    page = mode === 'mine' || mode === 'foreign' ? 0 : initialCollectionListPage(listSort);
    previousPage = initialCollectionPreviousPage();
    requestAnimationFrame(attachScroll);
    void loadPage();
  });

  onDestroy(() => {
    if (foreign) closeLocalSearch();
    unregisterScrollKey?.();
    unregisterScrollKey = null;
    if (mode === 'hub' || mode === 'week') saveViewStateData(viewKey(), snapshot());
    detachScroll();
  });

  function onSortMenuChange(id: string) {
    sortOpen = false;
    onSortChange(Number(id));
  }
</script>

{#snippet userSearch()}
  <!-- Как поиск в «Списках»: поле на всю ширину под вкладками -->
  <div class="bm-tools" role="search">
    <div class="bm-tools__search">
      <UiV2PillField
        size="md"
        type="search"
        label={ownerLogin ? `Поиск в коллекциях у ${ownerLogin}` : 'Поиск в коллекциях'}
        value={deskQuery}
        autocomplete="off"
        spellcheck={false}
        oninput={(e) => (deskQuery = (e.currentTarget as HTMLInputElement).value)}
      >
        {#snippet icon()}{@html iconSearch(16)}{/snippet}
      </UiV2PillField>
      {#if deskQuery}
        <button type="button" class="bm-tools__clear" aria-label="Очистить поиск" onclick={() => (deskQuery = '')}>
          {@html iconX(14)}
        </button>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet weekHeaderActions()}
  <UiV2Button
    label="Создать"
    size="sm"
    variant="chrome"
    class="collections-create"
    onclick={createCollection}
  >
    {#snippet icon()}{@html iconPlus(16)}{/snippet}
  </UiV2Button>
{/snippet}

{#snippet createTile()}
  <div class="uiv2-collection uiv2-collection--poster">
    <span class="uiv2-collection__deck" aria-hidden="true">
      <span class="uiv2-collection__sheet uiv2-collection__sheet--back"></span>
      <span class="uiv2-collection__sheet uiv2-collection__sheet--mid"></span>
    </span>
    <UiV2Button
      label="Создать коллекцию"
      class="uiv2-collection__media uiv2-collection__media--poster collections-hub__create-tile"
      onclick={createCollection}
    >
      {#snippet icon()}{@html iconPlus(18)}{/snippet}
    </UiV2Button>
  </div>
{/snippet}

<div
  class="view view-collections-list discover-page collections-page"
  class:collections-page--mine={mode === 'mine'}
  bind:this={wrapEl}
>
  {#if mode === 'mine'}
    <UiV2SectionHeader title="Все созданные вами" />
  {:else if !isHub}
    <DiscoverHero
      title={pageTitle}
      subtitle={pageSubtitle}
      avatarUrl={foreign ? ownerAvatar : undefined}
      login={foreign ? ownerLogin : undefined}
      onTitleClick={foreign && userId ? () => openProfilePanel(userId!, { login: ownerLogin }) : undefined}
      actions={week ? weekHeaderActions : undefined}
    >
      {#if foreign && !isMobileMode()}
        {@render userSearch()}
      {/if}
    </DiscoverHero>
  {/if}

  {#if showHubSections}
    <section class="collections-hub__section">
      <UiV2SectionHeader
        title="Созданные вами"
        moreLabel={hubMine.length > 0 ? 'Показать все' : undefined}
        onShowAll={hubMine.length > 0 ? showAllMine : undefined}
      />
      <UiV2ReleaseCarousel scrollbar={false} measureKey={hubMine.length}>
        <div class="collections-hub__rail-item collections-hub__rail-item--wide">
          {@render createTile()}
        </div>
        {#each hubMine as item (item.id)}
          <div class="collections-hub__rail-item collections-hub__rail-item--wide">
            <CollectionCard data={item} layout="poster" variant="wide" />
          </div>
        {/each}
      </UiV2ReleaseCarousel>
    </section>
  {/if}

  {#if showHubSections && hubState === 'ready'}
    {#if hubWeekly.length > 0}
      <section class="collections-hub__section">
        <UiV2SectionHeader title="Популярные за неделю" />
        <UiV2ReleaseCarousel scrollbar={false} measureKey={hubWeekly.length}>
          {#each hubWeekly as item (item.id)}
            <div class="collections-hub__rail-item collections-hub__rail-item--wide">
              <CollectionCard data={item} layout="poster" variant="wide" />
            </div>
          {/each}
        </UiV2ReleaseCarousel>
      </section>
    {/if}

    {#if hubRecommended.length > 0}
      <section class="collections-hub__section">
        <UiV2SectionHeader title="Под ваш вкус" />
        <UiV2ReleaseCarousel scrollbar={false} measureKey={hubRecommended.length}>
          {#each hubRecommended as item (item.id)}
            <div class="collections-hub__rail-item collections-hub__rail-item--wide">
              <CollectionCard data={item} layout="poster" variant="wide" />
            </div>
          {/each}
        </UiV2ReleaseCarousel>
      </section>
    {/if}
  {/if}

  {#if isHub}
    <div class="collections-hub__toolbar">
      <span class="collections-hub__total" aria-live="polite">{totalLabel}</span>
      <button
        bind:this={sortBtn}
        type="button"
        class="collections-hub__sort"
        aria-haspopup="menu"
        aria-expanded={sortOpen}
        aria-label={`Сортировка: ${sortLabel}`}
        onclick={() => (sortOpen = !sortOpen)}
      >
        <span class="collections-hub__sort-icon" aria-hidden="true">{@html iconArrowUpDown(15)}</span>
        <span class="collections-hub__sort-label">{sortLabel}</span>
        <span class="collections-hub__sort-chevron" aria-hidden="true">{@html iconChevronDown(14)}</span>
      </button>
    </div>
    <UiV2PopupMenu
      open={sortOpen}
      dropdown
      anchor={sortBtn}
      title={isMobileMode() ? 'Сортировка' : ''}
      items={sortItems}
      onClose={() => (sortOpen = false)}
      onCheckedChange={(id) => onSortMenuChange(id)}
    />
  {/if}

  {#if loadState === 'loading' && items.length === 0}
    <div class="collections-hub__grid" aria-busy="true">
      {#if mode === 'mine'}{@render createTile()}{/if}
      <UiV2CollectionCardSkeleton layout="poster" bare count={skeletonCount} />
    </div>
  {:else if loadState === 'error'}
    <UiV2ContentRetryOverlay message={errorMsg} onRetry={retryLoad} />
  {:else if loadState === 'empty' && mode !== 'mine'}
    <div class="discover-empty">
      <span class="discover-empty__icon" aria-hidden="true">{@html iconLayoutGrid(26)}</span>
      <p class="discover-empty__title">Коллекций пока нет</p>
    </div>
  {:else}
    {#if foreign && searchQuery && visibleItems.length === 0 && !isLoading && !hasMore}
      <div class="discover-empty">
        <span class="discover-empty__icon" aria-hidden="true">{@html iconSearch(26)}</span>
        <p class="discover-empty__title">Ничего не найдено</p>
      </div>
    {:else}
      <div class="collections-hub__grid">
        {#if mode === 'mine'}{@render createTile()}{/if}
        {#each visibleItems as item (item.id)}
          <CollectionCard data={item} layout="poster" variant="wide" />
        {/each}
      </div>
      {#if isLoading}
        <div class="collections-hub__grid" aria-busy="true">
          <UiV2CollectionCardSkeleton layout="poster" bare count={2} />
        </div>
      {/if}
    {/if}
  {/if}
</div>
