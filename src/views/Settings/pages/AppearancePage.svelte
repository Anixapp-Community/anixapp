<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { navigate } from '../../../stores/navigation';
  import {
    getAllThemes,
    getActiveThemeId,
    applyThemeById,
    createCustomTheme,
    BUILT_IN_THEMES,
    type Theme,
  } from '../../../services/themes';
  import {
    getCardLayout,
    setCardLayout,
    getDefaultBookmarksTab,
    setDefaultBookmarksTab,
    type BookmarksTabId,
    type CardLayout,
  } from '../../../prefs';
  import UiV2Select, { type UiV2SelectOption } from '../../../components/uikit-v2/UiV2Select.svelte';

  import UiV2Button from '../../../components/uikit-v2/UiV2Button.svelte';
  import UiV2SettingsRow from '../../../components/uikit-v2/UiV2SettingsRow.svelte';
  import UiV2ZoomScaleSlider from '../../../components/uikit-v2/UiV2ZoomScaleSlider.svelte';
  import { DEFAULT_ZOOM, normalizeZoom, type ZoomLevel } from '../../../utils/zoom';
  import { isMac } from '../../../utils/platform';
  import { isMobileMode, MOBILE_UI_SCALES, getMobileUiScale, setMobileUiScale } from '../../../platform/mobile';

  const modKey = isMac ? '⌘' : 'Ctrl';
  /** Телефон: масштаб, навигация и редактор тем — функции окна ПК. */
  const touchOnly = isMobileMode();
  let mobileScale = $state(touchOnly ? getMobileUiScale() : 1);
  const canEditThemes = !touchOnly && !!(window.electron as { openThemeEditor?: unknown } | undefined)?.openThemeEditor;

  let cardLayout = $state<CardLayout>(getCardLayout());
  let bookmarksTab = $state<BookmarksTabId>(getDefaultBookmarksTab());

  /** Тот же список, что в настройках телефона. */
  const BOOKMARKS_OPTIONS: UiV2SelectOption[] = [
    { value: 'watching', label: 'Смотрю' },
    { value: 'planned', label: 'В планах' },
    { value: 'completed', label: 'Просмотрено' },
    { value: 'on_hold', label: 'Отложено' },
    { value: 'dropped', label: 'Брошено' },
    { value: 'collections', label: 'Коллекции' },
    { value: 'history', label: 'История' },
    { value: 'votes', label: 'Оценки' },
    { value: 'favorites', label: 'Избранное' },
  ];
  let activeThemeId = $state(getActiveThemeId());
  let customThemes = $state<Theme[]>([]);
  let uiZoom = $state<ZoomLevel>(DEFAULT_ZOOM);
  let zoomLoaded = $state(false);

  function refreshThemes() {
    customThemes = getAllThemes().filter((t) => !t.builtIn);
    activeThemeId = getActiveThemeId();
  }

  function selectTheme(themeId: string) {
    applyThemeById(themeId);
    activeThemeId = themeId;
  }

  function selectLayout(layout: CardLayout) {
    setCardLayout(layout);
    cardLayout = layout;
    const p = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
    if (p === '/' || p.startsWith('/catalog') || p.startsWith('/bookmarks')) {
      navigate(p);
    }
  }

  function openThemeEditor(themeId: string, isNew: boolean) {
    (window.electron as { openThemeEditor?: (opts: object) => void } | undefined)?.openThemeEditor?.({
      themeId,
      isNew,
    });
  }

  function addCustomTheme() {
    const theme = createCustomTheme();
    refreshThemes();
    openThemeEditor(theme.id, true);
  }

  function saveZoom(next: ZoomLevel) {
    uiZoom = next;
    window.electron?.saveSettings?.({ uiZoom: next });
    window.dispatchEvent(new CustomEvent('anix:uiZoomChanged', { detail: { uiZoom: next } }));
  }

  function onThemeEditorSaved() {
    refreshThemes();
  }
  function onThemeEditorDeleted() {
    refreshThemes();
  }

  function onUiZoomChanged(e: Event) {
    const next = (e as CustomEvent<{ uiZoom?: number }>).detail?.uiZoom;
    if (typeof next === 'number') uiZoom = normalizeZoom(next);
  }

  onMount(() => {
    refreshThemes();
    void window.electron?.getSettings?.().then((settings) => {
      uiZoom = normalizeZoom(settings?.uiZoom ?? DEFAULT_ZOOM);
      zoomLoaded = true;
    });
    window.addEventListener('anix:themeEditorSaved', onThemeEditorSaved);
    window.addEventListener('anix:themeEditorDeleted', onThemeEditorDeleted);
    window.addEventListener('anix:uiZoomChanged', onUiZoomChanged);
  });

  onDestroy(() => {
    window.removeEventListener('anix:themeEditorSaved', onThemeEditorSaved);
    window.removeEventListener('anix:themeEditorDeleted', onThemeEditorDeleted);
    window.removeEventListener('anix:uiZoomChanged', onUiZoomChanged);
  });
</script>

<div class="uiv2-settings uiv2-settings--appearance">
  <!-- Тема — то, что меняют чаще всего, поэтому первой -->
  <section class="uiv2-settings__block">
    <UiV2Select
      appearance="row"
      label="Тема оформления"
      options={[...BUILT_IN_THEMES, ...customThemes].map(({ id, name }) => ({ value: id, label: name }))}
      value={activeThemeId}
      onChange={selectTheme}
    />
  </section>

  {#if canEditThemes}
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Свои темы</h3>
      <div class="uiv2-settings__group">
        {#each customThemes as theme (theme.id)}
          <UiV2SettingsRow title={theme.name}>
            <UiV2Button label="Изменить" size="sm" onclick={() => openThemeEditor(theme.id, false)} />
          </UiV2SettingsRow>
        {/each}
        <UiV2Button label="Создать тему" onclick={addCustomTheme} />
      </div>
    </section>
  {/if}

  <section class="uiv2-settings__block">
    <UiV2Select
      appearance="row"
      label="Списки релизов"
      options={[{ value: 'wide', label: 'Списком' }, { value: 'mini', label: 'Карточками' }]}
      value={cardLayout}
      onChange={(value) => selectLayout(value as CardLayout)}
    />
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Закладки</h3>
    <UiV2Select
      appearance="row"
      label="Вкладка по умолчанию"
      description="Какой список открывать первым в разделе «Закладки»"
      options={BOOKMARKS_OPTIONS}
      value={bookmarksTab}
      onChange={(v) => { bookmarksTab = setDefaultBookmarksTab(v); }}
    />
  </section>

  {#if touchOnly}
    <section class="uiv2-settings__block">
      <UiV2Select
        appearance="row"
        label="Масштаб интерфейса"
        description="По умолчанию — 100%."
        options={MOBILE_UI_SCALES.map(({ value, label }) => ({ value: String(value), label }))}
        value={String(mobileScale)}
        onChange={(value) => { mobileScale = setMobileUiScale(Number(value)); }}
      />
    </section>
  {:else}
    <section class="uiv2-settings__block">
      {#if zoomLoaded}
        <UiV2ZoomScaleSlider value={uiZoom} onChange={saveZoom} />
        <p class="uiv2-settings__hint">Также можно нажать {modKey} + / {modKey} −.</p>
      {:else}
        <h3 class="uiv2-settings__title">Масштаб интерфейса</h3>
        <p class="uiv2-settings__status">Загрузка…</p>
      {/if}
    </section>
  {/if}
</div>
