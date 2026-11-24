<script lang="ts">
  import { onMount } from 'svelte';
  import UiV2SettingsToggle from '../../../components/uikit-v2/UiV2SettingsToggle.svelte';
  import UiV2SettingsRow from '../../../components/uikit-v2/UiV2SettingsRow.svelte';
  import { iconCheck, iconPlus } from '../../../components/icons';
  import {
    type DiscordRpcPageSettings,
    type DiscordRpcSettings,
    defaultDiscordRpcSettings,
    normalizeDiscordRpcSettings,
  } from '../../../services/discord-rpc-settings';
  import { invalidateDiscordRpcSettingsCache, refreshDiscordPresence } from '../../../services/discord-presence';

  interface PageItem {
    key: keyof DiscordRpcPageSettings;
    label: string;
    hint?: string;
    /** Вложенная опция — доступна только при включённом parentKey группы */
    nested?: boolean;
  }

  interface PageGroup {
    label: string;
    items: PageItem[];
    /** Родительская настройка для nested-пунктов группы */
    parentKey?: keyof DiscordRpcPageSettings;
  }

  const PAGE_GROUPS: PageGroup[] = [
    {
      label: 'Главная и обзор',
      items: [
        { key: 'discordRpcPageHome', label: 'Главная' },
        { key: 'discordRpcPageOverview', label: 'Обзор' },
        { key: 'discordRpcPagePopular', label: 'Популярное' },
      ],
    },
    {
      label: 'Коллекции',
      items: [
        { key: 'discordRpcPageCollections', label: 'Каталог коллекций' },
        { key: 'discordRpcPageMyCollections', label: 'Мои коллекции' },
        { key: 'discordRpcPageCollection', label: 'Просмотр коллекции' },
        { key: 'discordRpcPageCollectionEdit', label: 'Создание и правка' },
      ],
    },
    {
      label: 'Аниме',
      items: [
        { key: 'discordRpcPageRelease', label: 'Карточка тайтла' },
        { key: 'discordRpcPageReleaseComments', label: 'Комментарии' },
        { key: 'discordRpcPageReleaseRelated', label: 'Связанные тайтлы' },
      ],
    },
    {
      label: 'Профили',
      parentKey: 'discordRpcPageProfile',
      items: [
        { key: 'discordRpcPageProfile', label: 'Страница профиля' },
        { key: 'discordRpcPageProfileFriends', label: 'Друзья', nested: true },
        { key: 'discordRpcPageProfileVotes', label: 'Оценки', nested: true },
      ],
    },
    {
      label: 'Ещё',
      items: [
        { key: 'discordRpcPageBookmarks', label: 'Закладки' },
        { key: 'discordRpcPageDownloads', label: 'Загрузки' },
        { key: 'discordRpcPageAnnouncement', label: 'Чат в объявлении' },
        { key: 'discordRpcPageOther', label: 'Остальное', hint: 'Админка, UI Kit и прочие экраны' },
      ],
    },
  ];

  let hasElectron = $state(false);
  let loaded = $state(false);
  let settings = $state<DiscordRpcSettings>(defaultDiscordRpcSettings());

  const navigationEnabled = $derived(settings.discordRpcEnabled && settings.discordRpcShowBrowsing);

  async function loadSettings() {
    if (!window.electron?.getSettings) return;
    hasElectron = true;
    const raw = await window.electron.getSettings();
    settings = normalizeDiscordRpcSettings(raw as unknown as Record<string, unknown>);
    loaded = true;
  }

  function save(partial: Partial<DiscordRpcSettings>) {
    settings = { ...settings, ...partial };
    invalidateDiscordRpcSettingsCache();
    window.electron?.saveSettings?.(partial);
    refreshDiscordPresence();
  }

  function savePage(key: keyof DiscordRpcPageSettings, checked: boolean) {
    if (key === 'discordRpcPageProfile' && !checked) {
      save({
        discordRpcPageProfile: false,
        discordRpcPageProfileFriends: false,
        discordRpcPageProfileVotes: false,
      });
      return;
    }
    save({ [key]: checked } as Partial<DiscordRpcSettings>);
  }

  function isPageItemDisabled(item: PageItem, group: PageGroup): boolean {
    if (!navigationEnabled) return true;
    if (!item.nested || !group.parentKey) return false;
    return settings[group.parentKey] === false;
  }

  function isPageItemChecked(item: PageItem, group: PageGroup): boolean {
    return settings[item.key] && (!item.nested || !group.parentKey || settings[group.parentKey]);
  }

  function setPageGroup(group: PageGroup, checked: boolean) {
    save(Object.fromEntries(group.items.map((item) => [item.key, checked])));
  }

  onMount(() => void loadSettings());
</script>

<div class="uiv2-settings">
  {#if !hasElectron}
    <p class="uiv2-settings__status">Статус Discord работает только в десктоп-приложении AnixApp.</p>
  {:else if !loaded}
    <p class="uiv2-settings__status">Загрузка…</p>
  {:else}
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Основное</h3>
      <div class="uiv2-settings__group">
        <UiV2SettingsToggle
          label="Статус в Discord"
          description="Показывать в профиле Discord, чем вы заняты в AnixApp. Нужен запущенный Discord на этом ПК."
          checked={settings.discordRpcEnabled}
          onChange={(checked) => save({ discordRpcEnabled: checked })}
        />

        <UiV2SettingsToggle
          label="Где вы в приложении"
          description="Показывать текущий раздел в статусе. Если выключить — в Discord будет просто «AnixApp · В приложении»."
          checked={settings.discordRpcShowBrowsing}
          disabled={!settings.discordRpcEnabled}
          onChange={(checked) => save({ discordRpcShowBrowsing: checked })}
        />
      </div>
    </section>

    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Разделы приложения</h3>
      <p class="uiv2-settings__desc">
        Выберите экраны, для которых Discord будет показывать отдельный статус. Неактивные разделы отображаются как «в приложении».
      </p>
      <div class="discord-page-groups">
        {#each PAGE_GROUPS as group (group.label)}
          {@const selected = group.items.filter((item) => isPageItemChecked(item, group)).length}
          {@const allSelected = selected === group.items.length}
          <section class="discord-page-group">
            <header class="discord-page-group__header">
              <h4>{group.label} <span aria-label={`Выбрано ${selected} из ${group.items.length}`}>{selected}/{group.items.length}</span></h4>
              <button
                type="button"
                class="discord-page-group__action"
                aria-label={`${allSelected ? 'Снять выбор' : 'Выбрать все'} в группе «${group.label}»`}
                disabled={!navigationEnabled}
                onclick={() => setPageGroup(group, !allSelected)}
              >{allSelected ? 'Снять выбор' : 'Выбрать все'}</button>
            </header>
            <div class="discord-page-group__options">
              {#each group.items as item (item.key)}
                {@const checked = isPageItemChecked(item, group)}
                <button
                  type="button"
                  class="discord-page-option"
                  class:discord-page-option--parent={group.parentKey === item.key}
                  aria-pressed={checked}
                  disabled={isPageItemDisabled(item, group)}
                  onclick={() => savePage(item.key, !checked)}
                >
                  <span class="discord-page-option__icon" aria-hidden="true">{@html checked ? iconCheck(15) : iconPlus(15)}</span>
                  <span>
                    {item.label}
                    {#if item.hint}<small>{item.hint}</small>{/if}
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </section>

    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Плеер и лобби</h3>
      <div class="uiv2-settings__group">
        <UiV2SettingsToggle
          label="Текущая серия"
          description="Название аниме и номер серии, пока идёт воспроизведение в плеере."
          checked={settings.discordRpcShowWatching}
          disabled={!settings.discordRpcEnabled}
          onChange={(checked) => save({ discordRpcShowWatching: checked })}
        />

        <UiV2SettingsToggle
          label="Полоса прогресса"
          description="Таймер серии в Discord во время воспроизведения."
          checked={settings.discordRpcShowProgress}
          disabled={!settings.discordRpcEnabled || !settings.discordRpcShowWatching}
          onChange={(checked) => save({ discordRpcShowProgress: checked })}
        />

        <UiV2SettingsToggle
          label="Озвучка и плеер"
          description="Студия озвучки или источник видео в подписи к статусу."
          checked={settings.discordRpcShowDubber}
          disabled={!settings.discordRpcEnabled || !settings.discordRpcShowWatching}
          onChange={(checked) => save({ discordRpcShowDubber: checked })}
        />

        <UiV2SettingsToggle
          label="Обложки и аватары"
          description="Постер аниме или аватар профиля вместо логотипа AnixApp."
          checked={settings.discordRpcShowImages}
          disabled={!settings.discordRpcEnabled}
          onChange={(checked) => save({ discordRpcShowImages: checked })}
        />

        <UiV2SettingsToggle
          label="Приглашение в лобби"
          description="Кнопка «Присоединиться» в Discord, когда вы в лобби совместного просмотра."
          checked={settings.discordRpcShowParty}
          disabled={!settings.discordRpcEnabled}
          onChange={(checked) => save({ discordRpcShowParty: checked })}
        />

        <p class="uiv2-settings__note">
          Друзья увидят кнопку «Присоединиться» только если вы уже в лобби и эта опция включена.
        </p>
      </div>
    </section>
  {/if}
</div>

<style>
  .discord-page-groups {
    display: grid;
    gap: 0.55rem;
  }

  .discord-page-group {
    display: grid;
    gap: 0.5rem;
    padding: 0.65rem;
    border-radius: var(--settings-radius, 0.65rem);
    background: var(--uiv2-card-bg);
  }

  .discord-page-group__header,
  .discord-page-group__header h4 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .discord-page-group__header {
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .discord-page-group__header h4 {
    margin: 0;
    font-size: 0.8125rem;
  }

  .discord-page-group__header h4 span {
    padding: 0.15rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--uiv2-chrome-bg);
    color: var(--uiv2-fg-muted);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }

  .discord-page-group__action,
  .discord-page-option {
    border: 1px solid transparent;
    border-radius: 0.45rem;
    color: var(--uikit-v2-text);
    font: inherit;
    cursor: pointer;
  }

  .discord-page-group__action {
    min-height: 1.75rem;
    padding: 0.2rem 0.45rem;
    background: transparent;
    color: var(--uiv2-fg-muted);
    font-size: 0.75rem;
  }

  .discord-page-group__options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
    gap: 0.3rem;
  }

  .discord-page-option {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    min-height: 2.35rem;
    padding: 0.4rem 0.5rem;
    background: var(--uiv2-chrome-bg);
    font-size: 0.8125rem;
    text-align: start;
  }

  .discord-page-option--parent {
    grid-column: 1 / -1;
  }

  .discord-page-option small {
    display: block;
    margin-top: 0.15rem;
    color: var(--uiv2-fg-muted);
    font-size: 0.72rem;
  }

  .discord-page-option__icon {
    display: flex;
    flex-shrink: 0;
    color: var(--uiv2-fg-muted);
  }

  .discord-page-option[aria-pressed='true'] {
    background: var(--settings-selected-bg, var(--uiv2-chrome-active-bg));
  }

  .discord-page-option[aria-pressed='true'] .discord-page-option__icon {
    color: var(--uikit-v2-accent);
  }

  .discord-page-group__action:hover:not(:disabled),
  .discord-page-option:hover:not(:disabled) {
    border-color: var(--uiv2-border-subtle);
  }

  .discord-page-group__action:focus-visible,
  .discord-page-option:focus-visible {
    outline: 2px solid var(--uikit-v2-accent);
    outline-offset: -2px;
  }

  .discord-page-group__action:disabled,
  .discord-page-option:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
