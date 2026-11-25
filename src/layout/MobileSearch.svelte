<script lang="ts">
  // Мобильная строка поиска и история запросов. Фильтры находятся на странице поиска.
  import { onDestroy } from 'svelte';
  import { iconClock, iconX } from '../components/icons';
  import { buildSearchRoute, LIVE_SEARCH_DELAY, LIVE_SEARCH_HISTORY_DELAY, openSearchPage, SEARCH_PLACEHOLDERS, updateLiveSearch, type SearchTab } from '../search-controller';
  import { pushBackHandler } from '../platform/mobile-back';
  import { navigate } from '../stores/navigation';
  import { addSearchHistory, clearSearchHistory, getSearchHistory, type SearchHistoryScope } from '../utils/search-history';

  interface Props {
    /** Запрос, вкладка и поле поиска из адреса страницы. */
    value?: string;
    tab?: SearchTab;
    searchBy?: number;
    /** Поиск внутри страницы (закладки): своя подпись и история, запрос уходит сюда, а не на /search. */
    local?: { label: string; onQuery: (query: string) => void };
  }
  let { value = '', tab = 'releases', searchBy = 0, local }: Props = $props();

  const historyScope = $derived<SearchHistoryScope>(local ? 'bookmarks' : tab);
  const placeholder = $derived(local?.label ?? SEARCH_PLACEHOLDERS[tab]);

  let query = $derived(value);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  let focused = $state(false);
  let historyOpen = $state(false);
  let recent = $state<string[]>([]);
  let inputEl = $state<HTMLInputElement | null>(null);

  const showHistory = $derived(historyOpen || (local ? !value || focused : focused && !!query.trim() && query.trim() !== value.trim() && history.length > 0));
  const history = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return recent.filter((item) => item.toLocaleLowerCase('ru-RU').includes(needle));
  });

  $effect(() => {
    recent = getSearchHistory(historyScope);
  });

  $effect(() => {
    const input = inputEl;
    if (input && !input.value) input.focus();
  });

  $effect(() => {
    if (!historyOpen) return;
    return pushBackHandler(() => {
      historyOpen = false;
      return true;
    });
  });

  function toggleHistory() {
    historyOpen = !historyOpen;
    if (historyOpen) {
      recent = getSearchHistory(historyScope);
      inputEl?.blur();
    }
  }

  function onFocus() {
    recent = getSearchHistory(historyScope);
    focused = true;
  }

  function onBlur() {
    focused = false;
  }

  function scheduleSearch(event?: InputEvent) {
    historyOpen = false;
    cancelScheduledSearch();
    if (local || event?.isComposing) return;
    searchTimer = setTimeout(() => updateLiveSearch(query, tab, searchBy), LIVE_SEARCH_DELAY);
    historyTimer = setTimeout(() => {
      const q = query.trim();
      if (!q || q !== value) return;
      addSearchHistory(q, historyScope);
      recent = getSearchHistory(historyScope);
    }, LIVE_SEARCH_HISTORY_DELAY);
  }

  function cancelScheduledSearch() {
    clearTimeout(searchTimer);
    clearTimeout(historyTimer);
  }

  onDestroy(cancelScheduledSearch);

  function submit(text: string) {
    cancelScheduledSearch();
    const q = text.trim();
    if (!q && local) return;
    query = q;
    historyOpen = false;
    inputEl?.blur();
    if (!q) {
      openSearchPage(q);
      return;
    }
    addSearchHistory(q, historyScope);
    if (q === value) return;
    if (local) {
      local.onQuery(q);
      return;
    }
    navigate(buildSearchRoute(q, tab, tab === 'releases' ? searchBy : 0));
  }

  function clearInput() {
    query = '';
    scheduleSearch();
    if (local && value) local.onQuery('');
    inputEl?.focus();
  }

  function clearAll() {
    clearSearchHistory(historyScope);
    recent = [];
  }

</script>

<form class="m-searchbar" role="search" onsubmit={(e) => { e.preventDefault(); submit(query); }}>
  <input
    bind:this={inputEl}
    bind:value={query}
    type="search"
    enterkeyhint="search"
    autocomplete="off"
    {placeholder}
    aria-label={placeholder}
    onfocus={onFocus}
    oninput={scheduleSearch}
    oncompositionend={() => scheduleSearch()}
    onblur={onBlur}
  />
  {#if query}
    <!-- preventDefault: поле не теряет фокус, клавиатура не прячется -->
    <button type="button" class="m-icon-btn" aria-label="Очистить" onmousedown={(e) => e.preventDefault()} onclick={clearInput}>
      {@html iconX(24)}
    </button>
  {/if}
  {#if !local}
    <button
      type="button"
      class="m-icon-btn m-searchbar__history"
      class:m-searchbar__history--open={historyOpen}
      aria-label="История поиска"
      aria-expanded={showHistory}
      onclick={toggleHistory}
    >
      {@html iconClock(24)}
    </button>
  {/if}
</form>

{#if showHistory}
  {@const entries = historyOpen ? recent : history}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="m-search-history" onmousedown={(e) => e.preventDefault()}>
    {#if entries.length > 0}
      <div class="m-search-history__head">
        <span>История поиска</span>
        <button type="button" onclick={clearAll}>Очистить все</button>
      </div>
      {#each entries as item (item)}
        <button type="button" class="m-search-history__row" onclick={() => submit(item)}>
          {@html iconClock(24)}
          <span>{item}</span>
        </button>
      {/each}
    {:else if recent.length === 0}
      <p class="m-search-history__empty">Здесь появятся ваши запросы</p>
    {/if}
  </div>
{/if}

<style lang="scss">
  .m-searchbar__history--open { color: var(--m-on-secondary-container); background: var(--m-secondary-container); }

  .m-searchbar {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 48px;
    padding-left: var(--m-space-2);

    input {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: none;
      color: var(--m-text);
      font: 400 17px var(--m-font);
      appearance: none;
      &::placeholder { color: var(--m-text-2); }
      &::-webkit-search-cancel-button { display: none; }
    }
  }

  /* Под верхней панелью (12 + 48 + 9) и над таб-баром, поверх результатов */
  .m-search-history {
    position: fixed;
    top: calc(var(--safe-top) + 69px);
    left: var(--m-rail-left);
    right: var(--m-rail-right);
    bottom: calc(var(--m-nav-h) + var(--safe-bottom));
    z-index: 15;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--m-bg);
  }

  .m-search-history__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--m-space-1) 0 var(--m-gutter);
    color: var(--m-text-2);
    font-size: 15px;

    button {
      min-height: var(--m-touch);
      padding: 0 var(--m-space-3);
      border: 0;
      background: none;
      color: var(--m-text-2);
      font: 500 15px var(--m-font);
    }
  }

  .m-search-history__row {
    display: flex;
    align-items: center;
    gap: var(--m-space-5);
    width: 100%;
    min-height: 54px;
    padding: 0 var(--m-gutter);
    border: 0;
    background: none;
    color: var(--m-text);
    font: 400 16px var(--m-font);
    text-align: left;
    &:active { background: var(--m-press); }

    :global(svg) { flex: none; width: 24px; height: 24px; color: var(--m-text-2); }
    span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }

  .m-search-history__empty {
    margin: var(--m-space-5) var(--m-gutter);
    color: var(--m-text-2);
    font-size: 15px;
    text-align: center;
  }
</style>
