<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import Page from './Page.svelte';
  import { settingsModalInitialTab, settingsModalLastTab, settingsBossFightLock } from '../stores/modals';
  import AccountPage from '../views/Settings/pages/AccountPage.svelte';
  import AppearancePage from '../views/Settings/pages/AppearancePage.svelte';
  import ConnectionPage from '../views/Settings/pages/ConnectionPage.svelte';
  import BehaviorPage from '../views/Settings/pages/BehaviorPage.svelte';
  import NotificationsDevicePage from '../views/Settings/pages/NotificationsDevicePage.svelte';
  import PlaybackPage from '../views/Settings/pages/PlaybackPage.svelte';
  import DiscordRpcPage from '../views/Settings/pages/DiscordRpcPage.svelte';
  import AboutPage from '../views/Settings/pages/AboutPage.svelte';
  import UpdatePage from '../views/Settings/pages/UpdatePage.svelte';
  import DebugPage from '../views/Settings/pages/DebugPage.svelte';
  import DeveloperPage from '../views/Settings/pages/DeveloperPage.svelte';
  import UiV2Button from './uikit-v2/UiV2Button.svelte';
  import UiV2PillField from './uikit-v2/UiV2PillField.svelte';
  import UiV2RoundButton from './uikit-v2/UiV2RoundButton.svelte';
  import SidebarPanelResizeHandle from './SidebarPanelResizeHandle.svelte';
  import {
    iconX,
    iconPalette,
    iconBell,
    iconPlay,
    iconGlobe,
    iconDownload,
    iconSlidersHorizontal,
    iconSignal,
    iconRefreshCw,
    iconClipboardList,
    iconCodeXml,
    iconGift,
    iconMessageCircle,
    iconLink,
    iconInfo,
    iconSearch,
    iconUser,
  } from './icons';
  import { navigate } from '../stores/navigation';
  import { openSupportModal } from '../stores/support-promo';
  import { getSettingsPanelWidthPx, setSettingsPanelWidthPx } from '../prefs';
  import { requestOpenExternal } from '../utils/external-link';

  interface Props {
    onClose: () => void;
    /** Свой wrap/backdrop — экран входа без Layout. */
    standalone?: boolean;
    /** Экран входа без titlebar — панель от верхнего края. */
    flushTop?: boolean;
  }

  const { onClose, standalone = false, flushTop = false }: Props = $props();

  export type SettingsTab =
    | 'account'
    | 'appearance'
    | 'connection'
    | 'behavior'
    | 'notifications'
    | 'playback'
    | 'discord'
    | 'update'
    | 'debug'
    | 'developer'
    | 'about';

  const pages = {
    account: AccountPage,
    appearance: AppearancePage,
    connection: ConnectionPage,
    behavior: BehaviorPage,
    notifications: NotificationsDevicePage,
    playback: PlaybackPage,
    discord: DiscordRpcPage,
    update: UpdatePage,
    debug: DebugPage,
    developer: DeveloperPage,
    about: AboutPage,
  };

  /** Пункт меню: открывает вкладку настроек или выполняет действие (ссылка, другой экран). */
  type MenuRow = {
    tab?: SettingsTab;
    title: string;
    sub?: string;
    icon: (size?: number) => string;
    action?: () => void;
  };

  /** Группы — как на экране настроек Android: приложение · система · о проекте. */
  const MENU_GROUPS: { title: string; rows: MenuRow[] }[] = [
    {
      title: 'Приложение',
      rows: [
        { tab: 'appearance', title: 'Внешний вид', sub: 'Тема, масштаб, вид списков и навигация', icon: iconPalette },
        { tab: 'notifications', title: 'Уведомления', sub: 'Баннеры, звук и типы уведомлений', icon: iconBell },
        { tab: 'playback', title: 'Воспроизведение', sub: 'Плеер, Anime4K, звук и горячие клавиши', icon: iconPlay },
        { tab: 'connection', title: 'Соединение', sub: 'Сервер API, эндпоинты и задержка', icon: iconGlobe },
        { title: 'Загрузки', sub: 'Скачанные серии для просмотра без сети', icon: iconDownload, action: () => { close(); navigate('/downloads'); } },
      ],
    },
    {
      title: 'Система',
      rows: [
        { tab: 'behavior', title: 'Поведение', sub: 'Трей, ускорение и сведения о GPU', icon: iconSlidersHorizontal },
        { tab: 'discord', title: 'Discord Rich Presence', sub: 'Что вы смотрите — в статусе Discord', icon: iconSignal },
        { tab: 'update', title: 'Обновление', sub: 'Проверка обновлений, сборки и история версий', icon: iconRefreshCw },
        { tab: 'debug', title: 'Отладка', sub: 'Логи приложения и сети', icon: iconClipboardList },
      ],
    },
    {
      title: 'AnixApp',
      rows: [
        { title: 'Поддержать AnixApp', icon: iconGift, action: () => openSupportModal() },
        { title: 'Канал в Telegram', icon: iconMessageCircle, action: () => requestOpenExternal('https://t.me/anixapp') },
        { title: 'Исходный код на GitHub', icon: iconLink, action: () => requestOpenExternal('https://github.com/Anixapp-Community/anixapp') },
        { tab: 'about', title: 'О программе', icon: iconInfo },
      ],
    },
  ];

  const isDev = import.meta.env.DEV;
  const PANEL_ANIM_MS = 340;
  const groups: { title: string; rows: MenuRow[] }[] = [
    ...MENU_GROUPS,
    { title: 'Профиль', rows: [{ tab: 'account', title: 'Учётная запись', sub: 'Никнейм, статус, социальные сети и приватность', icon: iconUser }] },
    ...(isDev ? [{ title: 'Разработчик', rows: [{ tab: 'developer', title: 'Разработчик', sub: 'Мосты и UI Kit', icon: iconCodeXml }] }] : []),
  ];
  const deferred = new Set<SettingsTab>(['connection', 'update', 'debug', 'developer', 'account']);
  const anchors = new Map<string, HTMLElement>();
  let indexedText = $state<Partial<Record<SettingsTab, string>>>({});
  let expanded = $state<Partial<Record<SettingsTab, boolean>>>({});
  let query = $state('');
  let current = $state('appearance');
  let feed: HTMLElement;
  const rows = groups.flatMap((group) => group.rows);
  const searchTerms = $derived(normalizeSearch(query).split(/\s+/).filter(Boolean));
  const matches = $derived(rows.filter((row) => {
    const text = normalizeSearch([row.title, row.sub, row.tab && indexedText[row.tab]].filter(Boolean).join(' '));
    return searchTerms.every((term) => text.includes(term));
  }));

  let sheetOpen = $state(false);
  let closing = $state(false);
  let panelWidthPx = $state(getSettingsPanelWidthPx());
  let appVersion = $state('AnixApp');
  let componentsLine = $state('');
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let bossLocked = $state(false);

  $effect(() => {
    const unsub = settingsBossFightLock.subscribe((v) => {
      bossLocked = v;
    });
    return unsub;
  });

  function normalizeSearch(text: string) {
    return text.toLowerCase().replaceAll('ё', 'е').trim();
  }

  function registerSection(node: HTMLElement, row: MenuRow) {
    anchors.set(row.title, node);
    const tab = row.tab;
    const index = () => {
      if (tab) indexedText[tab] = node.textContent ?? '';
    };
    const observer = tab && tab !== 'debug' ? new MutationObserver(index) : null;
    if (observer) {
      index();
      observer.observe(node, { subtree: true, childList: true, characterData: true });
    }
    return { destroy() { observer?.disconnect(); anchors.delete(row.title); } };
  }

  async function openSection(row: MenuRow) {
    if (bossLocked) return;
    if (!row.tab) {
      row.action?.();
      return;
    }
    query = '';
    if (deferred.has(row.tab)) expanded[row.tab] = true;
    current = row.tab;
    await tick();
    const anchor = anchors.get(row.title);
    const viewport = feed?.parentElement;
    if (anchor && viewport) {
      viewport.scrollTop += anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      anchor.focus({ preventScroll: true });
    }
  }

  function followScroll() {
    const viewport = feed?.parentElement;
    if (!viewport || query || bossLocked) return;
    const top = viewport.getBoundingClientRect().top + 24;
    for (const row of rows) {
      if (!row.tab) continue;
      const anchor = anchors.get(row.title);
      if (anchor && anchor.getBoundingClientRect().bottom > top) {
        current = row.tab;
        break;
      }
    }
  }

  $effect(() => {
    const tab = $settingsModalInitialTab;
    const row = tab ? rows.find((item) => item.tab === tab) : undefined;
    if (row) untrack(() => void openSection(row));
  });

  $effect(() => {
    if (searchTerms.length || bossLocked) {
      const viewport = feed?.parentElement;
      if (viewport) viewport.scrollTop = 0;
    }
  });

  function close() {
    if (bossLocked) return;
    if (standalone) {
      if (closing) return;
      closing = true;
      sheetOpen = false;
      if (closeTimer != null) clearTimeout(closeTimer);
      closeTimer = setTimeout(onClose, PANEL_ANIM_MS + 50);
      return;
    }
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!standalone) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (bossLocked) {
        e.preventDefault();
        return;
      }
      close();
    }
  }

  onMount(() => {
    const viewport = feed?.parentElement;
    viewport?.addEventListener('scroll', followScroll, { passive: true });
    if (standalone) {
      document.addEventListener('keydown', handleKeydown);
      window.addEventListener('anix:settingsPanelRequestClose', close);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!closing) sheetOpen = true;
        });
      });
    }

    if (typeof window.electron?.getVersions === 'function') {
      void window.electron.getVersions().then((v) => {
        if (v.app) appVersion = `AnixApp v${v.app}`;
        const parts: string[] = [];
        if (v.electron) parts.push(`Electron ${v.electron}`);
        if (v.chrome) parts.push(`Chrome ${v.chrome}`);
        if (v.node) parts.push(`Node ${v.node}`);
        const apiVer = v.anixapi || v.anixartjs;
        if (apiVer) parts.push(`AnixApi ${apiVer}`);
        componentsLine = parts.join(' · ');
      }).catch(() => {});
    } else if (typeof window.electron?.getAppVersion === 'function') {
      void window.electron.getAppVersion().then((v: string) => {
        if (v) appVersion = `AnixApp v${v}`;
      }).catch(() => {});
    }
    return () => viewport?.removeEventListener('scroll', followScroll);
  });

  onDestroy(() => {
    settingsModalLastTab.set(current);
    document.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('anix:settingsPanelRequestClose', close);
    if (closeTimer != null) clearTimeout(closeTimer);
  });
</script>

{#snippet panelBody()}
  <div
    class="profile-panel settings-workspace settings-design"
    class:profile-panel--boss-lock={bossLocked}
    role="dialog"
    aria-modal="true"
    aria-label="Настройки приложения"
  >
    <header class="settings-workspace__header" aria-hidden={bossLocked}>
      <h2>Настройки</h2>
      <UiV2RoundButton label="Закрыть" onclick={close} disabled={bossLocked}>
        {@html iconX(18)}
      </UiV2RoundButton>
    </header>
    <div class="settings-workspace__body">
      <nav class="settings-workspace__nav" aria-label="Разделы настроек" inert={bossLocked}>
        {#each groups as group (group.title)}
          <div class="settings-workspace__nav-group">
            <p>{group.title}</p>
            {#each group.rows as row (row.title)}
              {#if row.tab}
                <button
                  type="button"
                  class="settings-workspace__nav-item"
                  aria-current={current === row.tab ? 'location' : undefined}
                  onclick={() => openSection(row)}
                >
                  <span aria-hidden="true">{@html row.icon(17)}</span>
                  {row.title}
                </button>
              {/if}
            {/each}
          </div>
        {/each}
      </nav>
      <div class="settings-workspace__main">
        <div class="settings-workspace__search" inert={bossLocked}>
          <UiV2PillField label="Поиск по настройкам" type="search" bind:value={query} spellcheck={false}>
            {#snippet icon()}{@html iconSearch(17)}{/snippet}
          </UiV2PillField>
          {#if query}
            <UiV2RoundButton size="sm" label="Очистить поиск" onclick={() => (query = '')}>
              {@html iconX(16)}
            </UiV2RoundButton>
          {/if}
        </div>
        <Page scrollId="settings-panel" extraClass="profile-panel__page settings-workspace__page" noPadding>
          <div class="settings-workspace__feed" bind:this={feed}>
            {#each rows as row (row.title)}
              {#if row.tab}
                {@const tab = row.tab}
                {@const Content = pages[tab]}
                <section
                  class="settings-workspace__section"
                  hidden={bossLocked ? tab !== 'update' : !matches.includes(row)}
                  tabindex="-1"
                  aria-label={row.title}
                  use:registerSection={row}
                >
                  <h3>{@html row.icon(19)} {row.title}</h3>
                  {#if !deferred.has(tab) || expanded[tab]}
                    <div class="settings-panel__page" class:settings-panel__page--fill={tab === 'debug'}>
                      <Content />
                    </div>
                  {:else}
                    <div class="uiv2-settings__group uiv2-settings__group--pad">
                      {#if row.sub}<p class="uiv2-settings__desc">{row.sub}</p>{/if}
                      <div><UiV2Button label="Открыть раздел" onclick={() => openSection(row)} /></div>
                    </div>
                  {/if}
                </section>
              {/if}
            {/each}
            {#if !bossLocked && matches.some((row) => !row.tab)}
              <section class="settings-workspace__section">
                <h3>Быстрые действия</h3>
                <div class="settings-workspace__actions">
                  {#each matches.filter((row) => !row.tab) as row (row.title)}
                    <UiV2Button label={row.title} onclick={() => openSection(row)}>
                      {#snippet icon()}{@html row.icon(16)}{/snippet}
                    </UiV2Button>
                  {/each}
                </div>
              </section>
            {:else if !bossLocked && matches.length === 0}
              <p class="uiv2-settings__status" role="status">Ничего не найдено</p>
            {/if}
            {#if !bossLocked && !searchTerms.length}
              <footer class="settings-panel__meta">
                <span>{appVersion}</span>
                {#if componentsLine}<p class="settings-panel__meta-components">{componentsLine}</p>{/if}
              </footer>
            {/if}
          </div>
        </Page>
      </div>
    </div>
  </div>
{/snippet}

{#if standalone}
  <button
    type="button"
    class="schedule-panel-backdrop"
    class:schedule-panel-backdrop--open={sheetOpen}
    class:schedule-panel-backdrop--flush-top={flushTop}
    class:schedule-panel-backdrop--locked={bossLocked}
    aria-label="Закрыть настройки"
    disabled={bossLocked}
    onclick={close}
  ></button>

  <aside
    class="schedule-panel-wrap schedule-panel-wrap--profile schedule-panel-wrap--settings"
    class:schedule-panel-wrap--open={sheetOpen}
    class:schedule-panel-wrap--flush-top={flushTop}
    aria-label="Настройки"
    aria-hidden={!sheetOpen}
  >
    <div class="schedule-panel-shell schedule-panel-shell--profile" style={`width: ${panelWidthPx}px`}>
      <div class="schedule-panel-shell__body">
        {@render panelBody()}
      </div>
      <SidebarPanelResizeHandle
        widthPx={panelWidthPx}
        label="Ширина настроек"
        onWidthChange={(w) => {
          panelWidthPx = w;
        }}
        onWidthCommit={(w) => {
          panelWidthPx = setSettingsPanelWidthPx(w);
        }}
      />
    </div>
  </aside>
{:else}
  {@render panelBody()}
{/if}

<style>
  .settings-workspace {
    container: settings-workspace / inline-size;
    background: var(--uikit-v2-bg);
    color: var(--uikit-v2-text);
    font-family: var(--uikit-v2-font, inherit);
  }

  .settings-workspace__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--uiv2-border-subtle);
  }

  .settings-workspace__header h2 {
    margin: 0;
    font-size: 1.125rem;
  }

  .settings-workspace__body {
    display: grid;
    grid-template-columns: 11rem minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  .settings-workspace__nav {
    overflow: auto;
    padding: 0.65rem;
    border-inline-end: 1px solid var(--uiv2-border-subtle);
    background: var(--uiv2-surface-subtle);
  }

  .settings-workspace__nav-group + .settings-workspace__nav-group {
    margin-top: 0.85rem;
  }

  .settings-workspace__nav-group p {
    margin: 0.35rem 0.6rem;
    color: var(--uiv2-fg-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .settings-workspace__nav-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.55rem 0.6rem;
    border: 0;
    border-radius: 0.65rem;
    background: transparent;
    color: var(--uiv2-fg-muted);
    text-align: start;
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .settings-workspace__nav-item span {
    display: flex;
    flex-shrink: 0;
  }

  .settings-workspace__nav-item:hover {
    background: var(--uiv2-hover-bg);
    color: var(--uikit-v2-text);
  }

  .settings-workspace__nav-item[aria-current] {
    background: var(--uiv2-chrome-active-bg);
    color: var(--uiv2-chrome-active-fg);
  }

  .settings-workspace__nav-item:focus-visible,
  .settings-workspace__section:focus-visible {
    outline: 2px solid var(--uikit-v2-accent);
    outline-offset: -2px;
  }

  .settings-workspace__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .settings-workspace__main :global(.settings-workspace__page) {
    flex: 1;
  }

  .settings-workspace__search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--uiv2-border-subtle);
  }

  .settings-workspace__search :global(.uiv2-pill-field) {
    flex: 1;
    min-width: 0;
    width: auto;
  }

  .settings-workspace__feed {
    display: grid;
    gap: 1.35rem;
    padding: 0.85rem 1rem 1.25rem;
  }

  .settings-workspace__section {
    min-width: 0;
    padding-bottom: 1.15rem;
    border-bottom: 1px solid var(--uiv2-border-subtle);
  }

  .settings-workspace__section h3 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0 0 0.9rem;
    color: var(--uikit-v2-text);
    font-size: 1rem;
    font-weight: 700;
  }

  .settings-workspace__section > .settings-panel__page,
  .settings-workspace__feed > .settings-panel__meta {
    padding: 0;
  }

  .settings-workspace__section > .settings-panel__page--fill {
    height: min(55vh, 32rem);
  }

  .settings-workspace__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .profile-panel--boss-lock .settings-workspace__nav,
  .profile-panel--boss-lock .settings-workspace__search,
  .profile-panel--boss-lock .settings-workspace__header {
    display: none;
  }

  .profile-panel--boss-lock .settings-workspace__body {
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }

  @container settings-workspace (max-width: 34rem) {
    .settings-workspace__body {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    .settings-workspace__nav {
      display: flex;
      gap: 0.35rem;
      border-inline-end: 0;
      border-bottom: 1px solid var(--uiv2-border-subtle);
    }

    .settings-workspace__nav-group {
      display: flex;
    }

    .settings-workspace__nav-group + .settings-workspace__nav-group {
      margin-top: 0;
    }

    .settings-workspace__nav-group p {
      display: none;
    }

    .settings-workspace__nav-item {
      white-space: nowrap;
    }
  }
</style>
