<script lang="ts">
  /**
   * Фильтр релизов: «Моя вкладка» и поиск по фильтру (как FilterFragment в Anixart 11).
   * Список полей с текущими значениями, выбор открывается следующим уровнем внутри панели.
   * На телефоне и планшете — шторка снизу, на ПК — окно по центру; оформление общее с меню (.uiv2-menu-sheet).
   */
  import { onMount, untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { revealFilterList } from '../utils/revealFilterList';
  import { fade, fly } from 'svelte/transition';
  import { portal } from '../actions/portal';
  import { sheetDrag, sheetPage } from '../actions/sheet';
  import { uiv2CustomScroll } from '../actions/uiv2CustomScroll';
  import {
    AGE_RATINGS,
    ALL_GENRES,
    BOOKMARKS_EXCLUDE_HINT,
    CATEGORIES,
    COUNTRIES,
    EPISODE_DURATIONS,
    EPISODES_PRESETS,
    GENRE_SECTIONS,
    SEASONS,
    SORT_OPTIONS,
    SOURCES,
    STATUSES,
    STUDIOS,
  } from '../data/filterOptions';
  import { pushBackHandler } from '../platform/mobile-back';
  import { isMobileMode } from '../platform/mobile';
  import {
    DEFAULT_CUSTOM_FILTER,
    GENRES_MODE_ALL,
    GENRES_MODE_ANY,
    GENRES_MODE_EXCLUDE,
    type CustomFilterStorage,
    type GenresMode,
  } from '../utils/homeCustomTab';
  import { iconArrowDown, iconArrowLeft, iconArrowUp, iconCheck, iconChevronDown, iconX } from './icons';
  import UiV2Button from './uikit-v2/UiV2Button.svelte';
  import UiV2Select from './uikit-v2/UiV2Select.svelte';

  interface Props {
    title: string;
    /** Пояснение над полями. */
    notice?: string;
    initial: CustomFilterStorage;
    applyLabel?: string;
    presentation?: 'sheet' | 'popover' | 'inline';
    onSearch?: (filter: CustomFilterStorage) => void;
    onApply: (filter: CustomFilterStorage) => void;
    onClose?: () => void;
    gridLayout?: boolean;
  }
  let { title, notice = '', initial, applyLabel = 'Применить', presentation = 'sheet', onSearch, onApply, onClose, gridLayout = false }: Props = $props();

  type Option = { value: string; label: string; desc?: string; icon?: string };
  type OptionGroup = { title: string; options: Option[] };
  type Field =
    | { id: string; group: string; label: string; kind: 'single'; options: Option[]; value: string; set: (v: string) => void }
    | { id: string; group: string; label: string; kind: 'multi'; groups: OptionGroup[]; values: string[]; set: (v: string[]) => void; hint?: string }
    | { id: string; group: string; label: string; kind: 'years' };

  const NOT_SET = 'Неважно';
  /** Длиннее этого списка нужен поиск. */
  const SEARCH_FROM = 12;
  /** Anixart предупреждает: со всеми жанрами сразу выдача быстро становится пустой. */
  const GENRES_WARN_FROM = 4;
  const MODE_TABS: { id: GenresMode; label: string; hint: string }[] = [
    { id: GENRES_MODE_ALL, label: 'Все', hint: 'Покажем релизы со всеми выбранными жанрами. Для точного результата выбирайте не больше 2–3 жанров.' },
    { id: GENRES_MODE_ANY, label: 'Хотя бы один', hint: 'Покажем релизы хотя бы с одним выбранным жанром.' },
    { id: GENRES_MODE_EXCLUDE, label: 'Исключить', hint: 'Покажем только релизы без выбранных жанров.' },
  ];

  const mobile = isMobileMode();
  let filter = $state<CustomFilterStorage>(untrack(() => ({ ...initial })));
  let voiceovers = $state<Option[]>([]);
  let panelEl = $state<HTMLDivElement | null>(null);
  const inlineGrid = $derived(gridLayout && presentation !== 'sheet');
  const mobileGrid = $derived(mobile && inlineGrid);
  const COLLAPSED_KEY = 'anixapp.search.filters.collapsed';

  function loadCollapsed(): boolean {
    try {
      return inlineGrid && (mobileGrid
        ? localStorage.getItem(`${COLLAPSED_KEY}.mobile`) === 'true'
        : localStorage.getItem(COLLAPSED_KEY) !== 'false');
    } catch {
      return inlineGrid && !mobileGrid;
    }
  }

  let collapsed = $state(untrack(loadCollapsed));

  function toggleCollapsed() {
    collapsed = !collapsed;
    try {
      localStorage.setItem(mobileGrid ? `${COLLAPSED_KEY}.mobile` : COLLAPSED_KEY, String(collapsed));
    } catch {
      // Keep the current state even when storage is unavailable.
    }
  }
  let detailAnchor: HTMLButtonElement | null = null;
  let detailPosition = $state({ left: 0, edge: 0, upward: false, fromRight: false, width: 0, available: 0 });
  let bodyHeight = $state<number | null>(null);
  let levelId = $state<string | null>(null);
  let levelDir = $state<1 | -1>(1);
  let query = $state('');

  function withNotSet(options: Option[]): Option[] {
    return [{ value: '', label: NOT_SET }, ...options];
  }

  const byValue = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));
  const byId = (rows: readonly { id: number; label: string }[]): Option[] =>
    rows.map((row) => ({ value: String(row.id), label: row.label }));

  const baseGenres = ALL_GENRES.filter((g) => !GENRE_SECTIONS.some((s) => (s.genres as readonly string[]).includes(g)));
  const GENRE_GROUPS: OptionGroup[] = [
    { title: '', options: byValue(baseGenres) },
    ...GENRE_SECTIONS.map((s) => ({ title: s.title, options: byValue(s.genres) })),
  ];
  const BOOKMARK_OPTIONS: Option[] = [
    { value: '0', label: 'Избранное' },
    { value: '1', label: 'Смотрю' },
    { value: '2', label: 'В планах' },
    { value: '3', label: 'Просмотрено' },
    { value: '4', label: 'Отложено' },
    { value: '5', label: 'Брошено' },
  ];
  const FIRST_YEAR = 1912;
  const LAST_YEAR = new Date().getFullYear() + 1;
  const minYear = $derived(Math.min(FIRST_YEAR, filter.selected_start_year ?? FIRST_YEAR, filter.selected_end_year ?? LAST_YEAR));
  const maxYear = $derived(Math.max(LAST_YEAR, filter.selected_start_year ?? FIRST_YEAR, filter.selected_end_year ?? LAST_YEAR));
  const startYear = $derived(filter.selected_start_year ?? minYear);
  const endYear = $derived(filter.selected_end_year ?? maxYear);
  const yearProgress = (year: number) => (year - minYear) / (maxYear - minYear);

  function patch(next: Partial<CustomFilterStorage>) {
    filter = { ...filter, ...next };
  }

  const numberOrNull = (v: string) => (v ? Number(v) : null);
  const numberText = (v: number | null) => (v == null ? '' : String(v));

  const fields = $derived.by((): Field[] => [
    { id: 'sort', group: 'Главное', label: 'Сортировка', kind: 'single',
      options: SORT_OPTIONS.map(({ value, label, hint }) => ({
        value: String(value),
        label: label.replace(/ [▲▼]$/, ''),
        desc: hint,
        icon: label.endsWith('▲') ? iconArrowUp(14) : iconArrowDown(14),
      })),
      value: String(filter.selected_sort ?? 0), set: (v) => patch({ selected_sort: Number(v) }) },
    { id: 'category', group: 'Главное', label: 'Категория', kind: 'single', options: withNotSet(byId(CATEGORIES)),
      value: numberText(filter.selected_category_id), set: (v) => patch({ selected_category_id: numberOrNull(v) }) },
    { id: 'status', group: 'Главное', label: 'Статус', kind: 'single', options: withNotSet(byId(STATUSES)),
      value: numberText(filter.selected_status_id), set: (v) => patch({ selected_status_id: numberOrNull(v) }) },
    { id: 'genres', group: 'Главное', label: 'Жанры', kind: 'multi', groups: GENRE_GROUPS,
      values: filter.selected_genres, set: (v) => patch({ selected_genres: v }) },

    { id: 'years', group: 'Когда вышло', label: 'Годы', kind: 'years' },
    { id: 'season', group: 'Когда вышло', label: 'Сезон', kind: 'single', options: withNotSet(byId(SEASONS)),
      value: numberText(filter.selected_season), set: (v) => patch({ selected_season: numberOrNull(v) }) },

    { id: 'country', group: 'Подробнее', label: 'Страна', kind: 'single', options: withNotSet(byValue(COUNTRIES)),
      value: filter.selected_country, set: (v) => patch({ selected_country: v }) },
    { id: 'studio', group: 'Подробнее', label: 'Студия', kind: 'single', options: withNotSet(byValue(STUDIOS)),
      value: filter.selected_studio, set: (v) => patch({ selected_studio: v }) },
    { id: 'source', group: 'Подробнее', label: 'Первоисточник', kind: 'single', options: withNotSet(byValue(SOURCES)),
      value: filter.selected_source, set: (v) => patch({ selected_source: v }) },
    { id: 'types', group: 'Подробнее', label: 'Озвучки', kind: 'multi', groups: [{ title: '', options: voiceovers }],
      values: filter.selected_types, set: (v) => patch({ selected_types: v }) },
    { id: 'episodes', group: 'Подробнее', label: 'Эпизодов', kind: 'single', options: withNotSet(byId(EPISODES_PRESETS)),
      value: numberText(filter.selected_episodes), set: (v) => patch({ selected_episodes: numberOrNull(v) }) },
    { id: 'duration', group: 'Подробнее', label: 'Длительность эпизода', kind: 'single', options: withNotSet(byId(EPISODE_DURATIONS)),
      value: numberText(filter.selected_episode_duration), set: (v) => patch({ selected_episode_duration: numberOrNull(v) }) },
    { id: 'age', group: 'Подробнее', label: 'Возрастное ограничение', kind: 'multi', groups: [{ title: '', options: byId(AGE_RATINGS) }],
      values: filter.selected_age_ratings, set: (v) => patch({ selected_age_ratings: v }) },

    { id: 'exclusions', group: 'Исключить', label: 'Закладки', kind: 'multi', groups: [{ title: '', options: BOOKMARK_OPTIONS }],
      values: filter.selected_profile_list_exclusions, set: (v) => patch({ selected_profile_list_exclusions: v }), hint: BOOKMARKS_EXCLUDE_HINT },
  ]);

  const fieldGroups = $derived.by(() => {
    const groups: { title: string; fields: Field[] }[] = [];
    for (const field of fields) {
      const last = groups[groups.length - 1];
      if (last?.title === field.group) last.fields.push(field);
      else groups.push({ title: field.group, fields: [field] });
    }
    return groups;
  });

  const level = $derived(fields.find((field) => field.id === levelId) ?? null);
  const isDefault = $derived(JSON.stringify(filter) === JSON.stringify({ ...filter, ...DEFAULT_CUSTOM_FILTER }));
  const activeMode = $derived(MODE_TABS.find((tab) => tab.id === filter.selected_genres_mode) ?? MODE_TABS[0]);

  function yearsText(): string {
    const { selected_start_year: from, selected_end_year: to } = filter;
    if (from != null && to != null) return from === to ? String(from) : `${from} – ${to}`;
    if (from != null) return `с ${from}`;
    if (to != null) return `до ${to}`;
    return NOT_SET;
  }

  function fieldValueText(field: Field, full = false): string {
    if (field.kind === 'years') return yearsText();
    if (field.kind === 'single') return field.options.find((o) => o.value === field.value)?.label ?? NOT_SET;
    if (!field.values.length) return NOT_SET;
    const labels = field.values.map((v) => {
      for (const group of field.groups) {
        const hit = group.options.find((o) => o.value === v);
        if (hit) return hit.label;
      }
      return v;
    });
    const selected = !full && labels.length > 2
      ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
      : labels.join(', ');
    if (field.id !== 'genres') return selected;

    const prefix = {
      [GENRES_MODE_ALL]: 'Все',
      [GENRES_MODE_ANY]: 'Хотя бы один',
      [GENRES_MODE_EXCLUDE]: 'Искл',
    }[filter.selected_genres_mode];
    return `${prefix}: ${selected}`;
  }

  function isFieldSet(field: Field): boolean {
    if (field.kind === 'years') return filter.selected_start_year != null || filter.selected_end_year != null;
    if (field.kind === 'multi') return field.values.length > 0;
    return field.id === 'sort' ? field.value !== '0' : !!field.value;
  }

  function matches(option: Option): boolean {
    return option.label.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'));
  }

  function optionCount(field: Field): number {
    if (field.kind === 'single') return field.options.length;
    if (field.kind === 'multi') return field.groups.reduce((sum, group) => sum + group.options.length, 0);
    return 0;
  }

  function positionDetail() {
    if (!detailAnchor) return;
    const rect = detailAnchor.getBoundingClientRect();
    const width = Math.min(416, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 18;
    const above = rect.top - 18;
    const upward = above > below;
    const fromRight = rect.left > window.innerWidth - rect.right;
    detailPosition = {
      left: Math.max(12, Math.min(fromRight ? rect.right - width : rect.left, window.innerWidth - width - 12)),
      edge: upward ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
      upward,
      fromRight,
      width,
      available: Math.max(100, upward ? above : below),
    };
  }

  $effect(() => {
    if (!inlineGrid || mobileGrid || !levelId) return;
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.release-filter__detail-layer, [data-uiv2-select-portal]')) return;
      positionDetail();
    };
    const onOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || detailAnchor?.contains(target)) return;
      if (target.closest('.release-filter__detail, [data-uiv2-select-portal]')) return;
      back({ restoreFocus: false });
    };
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('click', onOutsideClick, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('click', onOutsideClick, true);
    };
  });

  function openLevel(id: string, event: MouseEvent) {
    if (inlineGrid && event.currentTarget instanceof HTMLButtonElement) {
      if (levelId === id) {
        back();
        return;
      }
      detailAnchor = event.currentTarget;
      if (!mobileGrid) positionDetail();
    }
    levelDir = 1;
    query = '';
    levelId = id;
  }

  function back({ restoreFocus = true } = {}) {
    levelDir = -1;
    levelId = null;
    if (restoreFocus) detailAnchor?.focus({ preventScroll: true });
    detailAnchor = null;
  }

  function toggle(field: Extract<Field, { kind: 'multi' }>, value: string) {
    field.set(field.values.includes(value) ? field.values.filter((v) => v !== value) : [...field.values, value]);
  }

  function setStartYear(year: number) {
    const start = Math.min(year, endYear);
    patch({ selected_start_year: start === FIRST_YEAR && minYear === FIRST_YEAR ? null : start });
  }

  function setEndYear(year: number) {
    const end = Math.max(year, startYear);
    patch({ selected_end_year: end === LAST_YEAR && maxYear === LAST_YEAR ? null : end });
  }

  function setGenresMode(mode: GenresMode) {
    patch({ selected_genres_mode: mode, is_genres_exclude_mode_enabled: mode === GENRES_MODE_EXCLUDE });
  }

  function reset() {
    filter = { ...DEFAULT_CUSTOM_FILTER };
  }

  function apply() {
    onApply($state.snapshot(filter) as CustomFilterStorage);
  }

  function onKeydown(e: KeyboardEvent) {
    // Открытый список выбора закрывается первым и помечает событие
    if (e.key !== 'Escape' || e.defaultPrevented || (!levelId && !onClose)) return;
    if (levelId) back();
    else if (onClose) onClose();
    e.preventDefault();
  }

  onMount(() => {
    const offBack = pushBackHandler(() => {
      if (levelId) back();
      else if (onClose) onClose();
      else return false;
      return true;
    });
    void window.anixApi?.type?.all?.().then((data) => {
      voiceovers = (data?.types ?? [])
        .filter((t): t is { id: number; name: string } => typeof t?.id === 'number' && typeof t?.name === 'string')
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((t) => ({ value: String(t.id), label: t.name }));
    }).catch(() => { voiceovers = []; });
    return offBack;
  });
</script>

<svelte:window onkeydown={onKeydown} onresize={positionDetail} />

{#if presentation === 'sheet'}
<div class="uiv2-menu-sheet release-filter" use:portal>
  <button
    type="button"
    class="uiv2-menu-sheet__scrim"
    aria-label="Закрыть"
    onclick={onClose}
    transition:fade|global={{ duration: 200 }}
  ></button>

  <div
    bind:this={panelEl}
    class="uiv2-menu-sheet__panel"
    role="dialog"
    aria-modal="true"
    aria-label={level?.label ?? title}
    transition:fly|global={mobile
      ? { y: '100%', duration: 280, easing: cubicOut, opacity: 1 }
      : { y: 16, duration: 200, easing: cubicOut }}
  >
    {@render panelContents(level ?? undefined)}
  </div>
</div>
{:else}
  <section
    class="release-filter release-filter--embedded"
    class:release-filter--grid={gridLayout}
    class:release-filter--popover={presentation === 'popover'}
    aria-label={title}
    transition:fly={{ y: -6, duration: 180, easing: cubicOut }}
  >
    {@render panelContents(gridLayout ? undefined : level ?? undefined)}
  </section>
{/if}

{#each inlineGrid && !mobileGrid && level ? [{ field: level, position: detailPosition }] : [] as { field, position } (field.id)}
  <div class="release-filter release-filter--embedded release-filter__detail-layer" use:portal>
    <section
      class="release-filter__detail"
      inert={levelId !== field.id}
      aria-label={field.label}
      style:left={`${position.left}px`}
      style:width={`${position.width}px`}
      style:top={position.upward ? undefined : `${position.edge}px`}
      style:bottom={position.upward ? `${position.edge}px` : undefined}
      style:--detail-height={`${Math.max(64, position.available - 64)}px`}
      in:revealFilterList={{ upward: position.upward, fromRight: position.fromRight }}
      out:revealFilterList={{ upward: position.upward, fromRight: position.fromRight, closing: true }}
    >
      {@render panelContents(field, true)}
    </section>
  </div>
{/each}

{#if mobileGrid && level}
  <div class="uiv2-menu-sheet release-filter" use:portal>
    <button
      type="button"
      class="uiv2-menu-sheet__scrim"
      aria-label="Закрыть параметры"
      onclick={() => back()}
      transition:fade|global={{ duration: 180 }}
    ></button>
    <div
      bind:this={panelEl}
      class="uiv2-menu-sheet__panel release-filter__mobile-detail"
      role="dialog"
      aria-modal="true"
      aria-label={level.label}
      transition:fly|global={{ y: '100%', duration: 280, easing: cubicOut, opacity: 1 }}
    >
      {@render panelContents(level, true)}
    </div>
  </div>
{/if}

{#snippet yearRange(label?: string)}
  <div class="release-filter__year-range">
    <div class="release-filter__year-values" aria-hidden="true">
      {#if label}<span class="release-filter__year-label">{label}</span>{/if}
      <span>{startYear}</span>
      <span>{endYear}</span>
    </div>
    <div
      class="release-filter__year-track"
      style:--year-start={yearProgress(startYear)}
      style:--year-end={yearProgress(endYear)}
    >
      <input
        type="range"
        min={minYear}
        max={maxYear}
        value={startYear}
        class:year-start--above={startYear === maxYear}
        aria-label="Год выхода от"
        oninput={(event) => {
          setStartYear(event.currentTarget.valueAsNumber);
          event.currentTarget.valueAsNumber = startYear;
        }}
      />
      <input
        type="range"
        min={minYear}
        max={maxYear}
        value={endYear}
        aria-label="Год выхода до"
        oninput={(event) => {
          setEndYear(event.currentTarget.valueAsNumber);
          event.currentTarget.valueAsNumber = endYear;
        }}
      />
    </div>
  </div>
{/snippet}

{#snippet filterField(field: Field)}
  {#if gridLayout && field.kind === 'years'}
    <div class="release-filter__year-tile">
      {@render yearRange(field.label)}
    </div>
  {:else if !mobileGrid && field.kind === 'single' && field.options.length <= SEARCH_FROM}
    <UiV2Select
      appearance="row"
      listPlacement={gridLayout ? 'overlay' : undefined}
      showSelectedDetails={!gridLayout}
      label={field.label}
      options={field.options}
      value={field.value}
      onChange={field.set}
    />
  {:else}
    <div class="uiv2-select uiv2-select--row">
      <div class="uiv2-select__field">
        <button
          type="button"
          class="uiv2-select__trigger"
          aria-expanded={inlineGrid ? levelId === field.id : undefined}
          onclick={(event) => openLevel(field.id, event)}
        >
          <span class="uiv2-select__row-copy">
            <span class="uiv2-select__row-label">{field.label}</span>
          </span>
          <span class="uiv2-select__value">
            <span class="uiv2-select__value-label" class:uiv2-select__value-label--placeholder={!isFieldSet(field)}>
              {fieldValueText(field)}
            </span>
          </span>
          <span class="uiv2-select__chevron" aria-hidden="true">{@html iconChevronDown(16)}</span>
        </button>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet panelContents(activeLevel: Field | undefined, floatingDetail = false)}
    <div class="uiv2-menu-sheet__head" use:sheetDrag={{ panel: () => panelEl, onClose: () => { if (floatingDetail && mobileGrid) back(); else onClose?.(); } }}>
      {#if presentation === 'sheet' || (floatingDetail && mobileGrid)}<span class="uiv2-menu-sheet__handle" aria-hidden="true"></span>{/if}
      <div class="uiv2-menu-sheet__bar">
        {#if activeLevel && !floatingDetail}
          <button type="button" class="uiv2-menu-sheet__back" aria-label="Назад" onclick={() => back()}>
            {@html iconArrowLeft(22)}
          </button>
        {/if}
        <span class="uiv2-menu-sheet__title release-filter__title">{activeLevel?.label ?? title}</span>
        {#if inlineGrid && !activeLevel}
          {#if !collapsed}
            {#if !isDefault}<UiV2Button label="Сбросить" size="sm" variant="ghost" onclick={reset} />{/if}
            {#if onSearch}
              <UiV2Button size="sm" variant="ghost" label="Искать по фильтрам" onclick={() => onSearch?.($state.snapshot(filter) as CustomFilterStorage)} />
            {/if}
            <UiV2Button label={applyLabel} size="sm" variant="primary" onclick={apply} />
          {/if}
          <UiV2Button
            label={collapsed ? 'Развернуть' : 'Свернуть'}
            ariaExpanded={!collapsed}
            size="sm"
            variant="ghost"
            onclick={toggleCollapsed}
          />
        {/if}
        {#if floatingDetail && mobileGrid}
          <button type="button" class="uiv2-menu-sheet__back" aria-label="Закрыть параметры" onclick={() => back()}>
            {@html iconX(20)}
          </button>
        {/if}
        {#if !floatingDetail && onClose && (!mobile || presentation !== 'sheet')}
          <button type="button" class="uiv2-menu-sheet__back" aria-label="Закрыть" onclick={onClose}>
            {@html iconX(20)}
          </button>
        {/if}
      </div>
    </div>

    {#if inlineGrid && !activeLevel}
      {@const selectedFields = fields.filter(isFieldSet)}
      <div class="release-filter__fold" class:release-filter__fold--closed={!collapsed} inert={!collapsed}>
        <div class="release-filter__fold-content">
          <ul class="release-filter__summary">
            {#each selectedFields as field (field.id)}
              <li><span>{field.label}</span> {fieldValueText(field, true)}</li>
            {:else}
              <li>Все релизы</li>
            {/each}
          </ul>
        </div>
      </div>
    {/if}

    <div
      class:release-filter__fold={inlineGrid && !floatingDetail}
      class:release-filter__fold--closed={inlineGrid && !floatingDetail && collapsed}
      inert={inlineGrid && !floatingDetail && collapsed}
    >
      <div class:release-filter__fold-content={inlineGrid && !floatingDetail}>
        <div class="uiv2-menu-sheet__body" style:height={floatingDetail || bodyHeight == null ? undefined : `${bodyHeight}px`}>
          {#key activeLevel?.id}
            <div
              class="uiv2-menu-sheet__page uiv2-scroll-area uiv2-scroll-area--y"
              use:uiv2CustomScroll={{ axis: 'y', viewportSelector: '.uiv2-menu-sheet__viewport', showOnScroll: true }}
              in:fly={{ x: floatingDetail ? 0 : levelDir * 40, duration: floatingDetail ? 0 : 240, easing: cubicOut }}
              out:fly={{ x: floatingDetail ? 0 : levelDir * -40, duration: floatingDetail ? 0 : 160, easing: cubicOut }}
            >
              <div class="uiv2-menu-sheet__viewport uiv2-scroll-area__viewport" use:sheetPage={(height) => { if (!floatingDetail) bodyHeight = height; }}>
                <div class="uiv2-menu-sheet__inner">
                  {#if !activeLevel}
                    {#if notice}<p class="release-filter__note">{notice}</p>{/if}
                    {#if gridLayout}
                      <div class="release-filter__grid">
                        {#each fields.filter((field) => field.kind !== 'years') as field (field.id)}
                          {@render filterField(field)}
                        {/each}
                        {#each fields.filter((field) => field.kind === 'years') as field (field.id)}
                          {@render filterField(field)}
                        {/each}
                      </div>
                    {:else}
                      {#each fieldGroups as group (group.title)}
                        <section class="release-filter__settings-group">
                          <h3 class="uiv2-settings__title">{group.title}</h3>
                          {#each group.fields as field (field.id)}
                            {@render filterField(field)}
                          {/each}
                        </section>
                      {/each}
                    {/if}
                  {:else if activeLevel.kind === 'years'}
                    {@render yearRange()}
                  {:else}
                    {#if activeLevel.id === 'genres'}
                      <div class="release-filter__modes" role="group" aria-label="Как учитывать жанры">
                        {#each MODE_TABS as tab (tab.id)}
                          <button
                            type="button"
                            class="release-filter__mode"
                            class:release-filter__mode--on={tab.id === activeMode.id}
                            aria-pressed={tab.id === activeMode.id}
                            onclick={() => setGenresMode(tab.id)}
                          >{tab.label}</button>
                        {/each}
                      </div>
                      <p class="release-filter__note">{activeMode.hint}</p>
                      {#if activeMode.id === GENRES_MODE_ALL && filter.selected_genres.length >= GENRES_WARN_FROM}
                        <p class="release-filter__note release-filter__note--warn">Выбрано слишком много жанров: выдача может оказаться пустой</p>
                      {/if}
                    {:else if activeLevel.kind === 'multi' && activeLevel.hint}
                      <p class="release-filter__note">{activeLevel.hint}</p>
                    {/if}

                    {#if optionCount(activeLevel) > SEARCH_FROM}
                      <input
                        class="release-filter__search"
                        type="search"
                        placeholder="Поиск"
                        aria-label="Поиск по списку"
                        autocomplete="off"
                        bind:value={query}
                      />
                    {/if}

                    {#if activeLevel.kind === 'single'}
                      {@const field = activeLevel}
                      <ul class="uiv2-menu-sheet__list">
                        {#each field.options.filter(matches) as option (option.value)}
                          <li>
                            <button
                              type="button"
                              class="uiv2-popup-menu__item"
                              class:uiv2-popup-menu__item--checked={option.value === field.value}
                              aria-pressed={option.value === field.value}
                              onclick={() => { field.set(option.value); back(); }}
                            >
                              <span class="uiv2-popup-menu__label">
                                {option.label}
                                {#if option.desc}<small class="release-filter__desc">{option.desc}</small>{/if}
                              </span>
                              {#if option.value === field.value}
                                <span class="uiv2-popup-menu__icon uiv2-popup-menu__icon--check" aria-hidden="true">{@html iconCheck(16)}</span>
                              {/if}
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      {@const field = activeLevel}
                      {#each field.groups as group (group.title)}
                        {@const visible = group.options.filter(matches)}
                        {#if visible.length}
                          {#if group.title}<h3 class="release-filter__group">{group.title}</h3>{/if}
                          <ul class="uiv2-menu-sheet__list">
                            {#each visible as option (option.value)}
                              <li>
                                <button
                                  type="button"
                                  class="uiv2-popup-menu__item"
                                  class:uiv2-popup-menu__item--checked={field.values.includes(option.value)}
                                  aria-pressed={field.values.includes(option.value)}
                                  onclick={() => toggle(field, option.value)}
                                >
                                  <span class="uiv2-popup-menu__label">{option.label}</span>
                                  {#if field.values.includes(option.value)}
                                    <span class="uiv2-popup-menu__icon uiv2-popup-menu__icon--check" aria-hidden="true">{@html iconCheck(16)}</span>
                                  {/if}
                                </button>
                              </li>
                            {/each}
                          </ul>
                        {/if}
                      {/each}
                    {/if}
                  {/if}
                </div>
              </div>
              <div class="uiv2-scroll-area__v-track" aria-hidden="true">
                <div class="uiv2-scroll-area__v-thumb"></div>
              </div>
            </div>
          {/key}
        </div>
      </div>
    </div>

    {#if !floatingDetail && !inlineGrid}
    <div hidden={collapsed} class="release-filter__foot">
      {#if activeLevel}
        <UiV2Button label="Готово" variant="primary" block onclick={() => back()} />
      {:else}
        {#if !isDefault}<UiV2Button label="Сбросить" variant="ghost" onclick={reset} />{/if}
        {#if onSearch}
          <UiV2Button label="Искать по фильтрам" variant="ghost" onclick={() => onSearch?.($state.snapshot(filter) as CustomFilterStorage)} />
        {/if}
        <UiV2Button label={applyLabel} variant="primary" block onclick={apply} />
      {/if}
    </div>
    {/if}
{/snippet}

<style>
  .release-filter__year-tile {
    grid-column: span 2;
    min-width: 0;
    min-height: 2.7rem;
    box-sizing: border-box;
    padding: 0.25rem 0.65rem;
    border-radius: var(--settings-radius, 0.65rem);
    background: var(--uiv2-card-bg);
  }

  @container (max-width: 22rem) {
    .release-filter__year-tile {
      grid-column: 1 / -1;
    }
  }

  .release-filter__year-label {
    margin-inline-end: auto;
    color: var(--uiv2-fg-muted);
    font-size: 0.73rem;
    font-weight: 500;
  }

  .release-filter__year-tile .release-filter__year-range {
    padding: 0;
  }

  .release-filter__year-tile .release-filter__year-values {
    gap: 0.45rem;
    margin-bottom: 0.15rem;
    font-size: 0.75rem;
  }

  .release-filter__year-tile .release-filter__year-track {
    --year-track-height: 1.05rem;
  }

  .release-filter__year-range {
    padding: 0 0.75rem 0.45rem;
  }

  .release-filter__year-values {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.45rem;
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }

  .release-filter__year-track {
    --year-thumb: 0.85rem;
    --year-track-height: 1.65rem;
    position: relative;
    height: var(--year-track-height);
    border-radius: 0.45rem;
    background: var(--uiv2-chrome-bg);
  }

  .release-filter__year-track::before {
    position: absolute;
    inset-block: 0;
    left: calc(var(--year-thumb) / 2 + (100% - var(--year-thumb)) * var(--year-start));
    right: calc(var(--year-thumb) / 2 + (100% - var(--year-thumb)) * (1 - var(--year-end)));
    background: color-mix(in srgb, var(--uikit-v2-accent) 40%, transparent);
    content: '';
  }

  .release-filter__year-track input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    appearance: none;
    margin: 0;
    padding: 0;
    background: transparent;
    pointer-events: none;
  }

  .release-filter__year-track input.year-start--above {
    z-index: 1;
  }

  .release-filter__year-track input::-webkit-slider-runnable-track {
    height: var(--year-track-height);
  }

  .release-filter__year-track input::-moz-range-track {
    height: var(--year-track-height);
    background: transparent;
  }

  .release-filter__year-track input::-webkit-slider-thumb {
    appearance: none;
    width: var(--year-thumb);
    height: var(--year-track-height);
    border: 0;
    border-radius: 0.35rem;
    background: var(--uikit-v2-accent);
    pointer-events: auto;
    cursor: ew-resize;
  }

  .release-filter__year-track input::-moz-range-thumb {
    width: var(--year-thumb);
    height: var(--year-track-height);
    border: 0;
    border-radius: 0.35rem;
    background: var(--uikit-v2-accent);
    pointer-events: auto;
    cursor: ew-resize;
  }

  .release-filter__year-track input:focus-visible {
    z-index: 1;
    outline: 2px solid var(--uikit-v2-accent);
    border-radius: inherit;
  }


  .release-filter__settings-group {
    display: grid;
    gap: 6px;
    padding-block: 6px 10px;
  }

  .release-filter__settings-group > h3 {
    margin: 0 0 2px;
  }

  .release-filter__settings-group :global(.uiv2-select__row-label) {
    text-align: start;
  }


  .release-filter--embedded {
    background: var(--sheet-bg);
    color: var(--sheet-text);
    border: 1px solid var(--uiv2-border, var(--uiv2-hover-bg));
    border-radius: 18px;
    min-width: 0;
    overflow: hidden;
    -webkit-app-region: no-drag;
  }
  .release-filter--embedded :global(.uiv2-menu-sheet__head) {
    touch-action: auto;
  }
  .release-filter--embedded :global(.uiv2-menu-sheet__body) {
    max-height: min(55dvh, 28rem);
  }
  .release-filter--embedded :global(.release-filter__foot) {
    flex-wrap: wrap;
  }
  .release-filter--grid {
    background: transparent;
    border: 0;
    border-radius: 0;
  }

  .release-filter--grid :global(.uiv2-menu-sheet__head),
  .release-filter--grid :global(.uiv2-menu-sheet__inner) {
    padding: 0;
  }

  .release-filter--grid :global(.uiv2-menu-sheet__bar) {
    min-height: 2rem;
    gap: 0.45rem;
    margin-bottom: 0.2rem;
  }

  .release-filter--grid :global(.uiv2-menu-sheet__body) {
    max-height: none;
  }

  .release-filter__fold {
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    transition:
      grid-template-rows 280ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 200ms ease;
  }

  .release-filter__fold--closed {
    grid-template-rows: 0fr;
    opacity: 0;
  }

  .release-filter__fold-content {
    min-height: 0;
    overflow: hidden;
  }

  @media (prefers-reduced-motion: reduce) {
    .release-filter__fold {
      transition: none;
    }
  }

  .release-filter__summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.75rem;
  }

  .release-filter__summary li {
    min-width: 0;
    max-width: 100%;
    padding: 0.25rem 0.5rem;
    border-radius: 0.45rem;
    background: var(--uiv2-card-bg);
    overflow-wrap: anywhere;
  }

  .release-filter__summary li span {
    margin-inline-end: 0.25rem;
    color: var(--uiv2-fg-muted);
  }

  .release-filter__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
    align-items: start;
    gap: 6px;
    padding-block: 2px;
  }

  :global(html.mobile-mode) .release-filter__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  :global(html.mobile-mode) .release-filter__grid > :nth-last-child(2):nth-child(odd) {
    grid-column: 1 / -1;
  }

  .release-filter__grid :global(.uiv2-select--row .uiv2-select__trigger) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 8px;
    min-height: 2.7rem;
    padding: 0.25rem 0.65rem;
    text-align: start;
  }

  .release-filter__grid :global(.uiv2-select__row-copy) {
    grid-column: 1 / -1;
  }

  .release-filter__grid :global(.uiv2-select__row-label) {
    font-size: 0.73rem;
    color: var(--uiv2-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .release-filter__grid :global(.uiv2-select--row .uiv2-select__row-copy + .uiv2-select__value) {
    max-width: none;
    text-align: start;
  }

  .release-filter :global(:is(.uiv2-menu-sheet__body, .release-filter__foot)[hidden]) {
    display: none;
  }

  .release-filter__detail-layer {
    position: fixed;
    inset: 0;
    z-index: 12045;
    pointer-events: none;
    background: transparent;
    border: 0;
  }

  .release-filter__detail {
    pointer-events: auto;
    position: absolute;
    overflow: hidden;
    background: var(--sheet-bg);
    border: 1px solid var(--uiv2-border, var(--uiv2-hover-bg));
    border-radius: 12px;
    box-shadow: var(--uiv2-chrome-shadow);
  }

  :is(.release-filter__detail, .release-filter__mobile-detail) :global(.uiv2-menu-sheet__body) {
    max-height: none;
    transition: none;
  }

  :is(.release-filter__detail, .release-filter__mobile-detail) :global(.uiv2-menu-sheet__body .uiv2-menu-sheet__page) {
    position: relative;
  }

  :is(.release-filter__detail, .release-filter__mobile-detail) :global(.uiv2-menu-sheet__viewport) {
    height: auto;
    max-height: min(45dvh, var(--detail-height, 45dvh));
  }

  .release-filter--popover {
    position: absolute;
    z-index: 60;
    inset-block-start: calc(100% + 8px);
    inset-inline-end: 0;
    width: min(26rem, calc(100vw - 24px));
    box-shadow: 0 12px 32px rgb(0 0 0 / 28%);
  }
</style>
