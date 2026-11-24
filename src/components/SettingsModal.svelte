<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
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
  import UiV2BackBar from './uikit-v2/UiV2BackBar.svelte';
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
    iconChevronRight,
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
  const sections = groups.flatMap((group) => group.rows);
  function resolveTab(value: string | null): SettingsTab | 'menu' {
    return sections.find((row) => row.tab === value)?.tab ?? 'menu';
  }

  let screen = $state<SettingsTab | 'menu'>(resolveTab(get(settingsModalInitialTab)));
  let view: HTMLElement;
  let menuScrollTop = 0;
  const currentSection = $derived(sections.find((row) => row.tab === screen));
  const backSegments = $derived([{ label: currentSection?.title ?? 'Настройки', active: true }]);

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

  async function showScreen(next: SettingsTab | 'menu') {
    if (bossLocked || screen === next) return;
    const viewport = view?.closest<HTMLElement>('[data-page-scroll]');
    if (screen === 'menu') menuScrollTop = viewport?.scrollTop ?? 0;
    const previous = screen;
    screen = next;
    await tick();
    if (screen !== next || !viewport) return;
    viewport.scrollTop = next === 'menu' ? menuScrollTop : 0;
    if (next === 'menu') {
      view.querySelector<HTMLButtonElement>(`[data-settings-tab="${previous}"]`)?.focus({ preventScroll: true });
    }
  }

  function onHeadBack() {
    if (screen === 'menu') close();
    else void showScreen('menu');
  }

  $effect(() => {
    const tab = resolveTab($settingsModalInitialTab);
    if (tab !== 'menu') untrack(() => void showScreen(tab));
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
  });

  onDestroy(() => {
    if (screen !== 'menu') settingsModalLastTab.set(screen);
    document.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('anix:settingsPanelRequestClose', close);
    if (closeTimer != null) clearTimeout(closeTimer);
  });
</script>

{#snippet panelBody()}
  <div
    class="profile-panel settings-design"
    class:profile-panel--boss-lock={bossLocked}
    role="dialog"
    aria-modal="true"
    aria-label="Настройки приложения"
  >
    <header class="profile-panel__chrome" inert={bossLocked}>
      <div class="profile-panel__close">
        <UiV2RoundButton label="Закрыть" onclick={close} disabled={bossLocked}>
          {@html iconX(18)}
        </UiV2RoundButton>
      </div>
    </header>

    <Page scrollId="settings-panel" extraClass="profile-panel__page" noPadding>
      <div class="profile-panel__edit-view" bind:this={view}>
        <header class="profile-panel__friends-head" inert={bossLocked}>
          <UiV2BackBar segments={backSegments} onBack={onHeadBack} />
        </header>

        {#if screen === 'menu'}
          <nav class="profile-panel__edit-menu settings-menu" aria-label="Разделы настроек">
            {#each groups as group, index (group.title)}
              {#if index > 0}<div class="profile-panel__edit-divider" aria-hidden="true"></div>{/if}
              <h3 class="settings-menu__group">{group.title}</h3>
              {#each group.rows as row (row.title)}
                <button
                  type="button"
                  class="settings-menu__row"
                  data-settings-tab={row.tab}
                  onclick={() => row.tab ? showScreen(row.tab) : row.action?.()}
                >
                  <span class="settings-menu__icon" aria-hidden="true">{@html row.icon(20)}</span>
                  <span class="settings-menu__text">
                    <span class="settings-menu__title">{row.title}</span>
                    {#if row.tab === 'about' || row.sub}
                      <span class="settings-menu__sub">{row.tab === 'about' ? appVersion : row.sub}</span>
                    {/if}
                  </span>
                  <span class="settings-menu__chevron" aria-hidden="true">{@html iconChevronRight(16)}</span>
                </button>
              {/each}
            {/each}
          </nav>
          <footer class="settings-panel__meta">
            <span>{appVersion}</span>
            {#if componentsLine}<p class="settings-panel__meta-components">{componentsLine}</p>{/if}
          </footer>
        {:else}
          {@const Content = pages[screen]}
          <div class="settings-panel__page" class:settings-panel__page--fill={screen === 'debug'}>
            <Content />
          </div>
        {/if}
      </div>
    </Page>
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
