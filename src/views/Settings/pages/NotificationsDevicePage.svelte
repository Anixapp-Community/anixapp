<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { isMobileMode } from '../../../platform/mobile';
  import UiV2SettingsToggle from '../../../components/uikit-v2/UiV2SettingsToggle.svelte';
  import UiV2SettingsSlider from '../../../components/uikit-v2/UiV2SettingsSlider.svelte';
  import UiV2Button from '../../../components/uikit-v2/UiV2Button.svelte';
  import UiV2Select, { type UiV2SelectOption } from '../../../components/uikit-v2/UiV2Select.svelte';
  import NotificationPreferencesPanel from '../../../components/NotificationPreferencesPanel.svelte';
  import {
    DEFAULT_NOTIFICATION_VOLUME,
    deviceNotificationSettings,
    loadDeviceNotificationSettings,
    saveDeviceNotificationSettings,
    previewNotificationSound,
    sendTestDeviceNotification,
    previewNotificationCorner,
    endNotificationCornerPreview,
    buildCornerPreviewItems,
    listNotificationSounds,
    hasDesktopBannerShell,
    type CornerPreviewItem,
  } from '../../../stores/device-notifications';
  import {
    BANNER_STYLE_OPTIONS,
    type NotificationBannerStyle,
    type NotificationKindId,
  } from '../../../utils/notification-kinds';
  import { resolveCdnAssetUrl } from '../../../utils/posterUrl';
  import type {
    NotificationBannerPosition,
    NotificationSoundOption,
  } from '../../../types/electron';

  const PREVIEW_IMAGE = resolveCdnAssetUrl(
    'https://s.anixmirai.com/posters/VPHehhgSpJ9VRap8e2VpahnZPYyaof.jpg',
  ) || 'https://s.anixmirai.com/posters/VPHehhgSpJ9VRap8e2VpahnZPYyaof.jpg';

  /** Desktop-оболочка с баннерами в углу (Electron на Win/Mac/Linux). */
  let hasBannerShell = $state(false);
  let loaded = $state(false);
  let sounds = $state<NotificationSoundOption[]>([]);
  let previewing = $state(false);
  let cornerPreviewRequest = 0;
  let stylePreviewPool = $state<CornerPreviewItem[]>([
    {
      title: 'Серия',
      body: 'Вышла «11 серия» «Необъятный океан 3» · JAM CLUB',
      kind: 'episode',
      image: PREVIEW_IMAGE,
    },
    {
      title: 'Комментарий',
      body: '«PIKA_4Y»: зацени новую серию!',
      kind: 'comment',
      image: PREVIEW_IMAGE,
    },
    {
      title: 'Друзья',
      body: '«FlexHunterZ» добавил вас в друзья',
      kind: 'friend',
      image: PREVIEW_IMAGE,
    },
  ]);

  const settings = $derived($deviceNotificationSettings);
  let hoveredCorner = $state<NotificationBannerPosition | null>(null);
  const previewCorner = $derived(hoveredCorner ?? settings.position);
  const stylePreviewItems = $derived(stylePreviewPool.slice(0, 1));
  const deviceOn = $derived(settings.desktopEnabled);
  /** Системные уведомления ОС — настройки приложения (звук, карточки) приглушены. */
  const appNotifsInactive = $derived(settings.useNativeNotifications);
  /** Есть канал доставки: ОС или баннеры приложения. */
  const canDeliver = $derived(
    deviceOn && (settings.useNativeNotifications || settings.customBannersEnabled),
  );

  function onBannerStyleChange(value: string) {
    save({ bannerStyle: value as NotificationBannerStyle });
  }

  async function saveAndPreviewCorner(patch: Parameters<typeof save>[0]) {
    const request = ++cornerPreviewRequest;
    await save(patch);
    if (request !== cornerPreviewRequest) return;
    await previewNotificationCorner(patch.position ?? settings.position, $state.snapshot(stylePreviewPool), 5000);
  }

  function emphasizeQuotes(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/«([^»]+)»/g, '<b>«$1»</b>');
  }

  const POSITIONS: { id: NotificationBannerPosition; label: string }[] = [
    { id: 'top-left', label: 'Сверху слева' },
    { id: 'top-right', label: 'Сверху справа' },
    { id: 'bottom-left', label: 'Снизу слева' },
    { id: 'bottom-right', label: 'Снизу справа' },
  ];

  const soundOptions = $derived<UiV2SelectOption[]>(
    sounds.map((s) => ({ value: s.id, label: s.label, desc: s.desc })),
  );

  const styleOptions = $derived<UiV2SelectOption[]>(
    BANNER_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label, desc: o.desc })),
  );

  function testKind(kind: NotificationKindId) {
    if (!canDeliver) return;
    // Звук только через канал доставки: ОС — системный, баннеры — мелодия приложения.
    void sendTestDeviceNotification(kind);
  }

  const volumePercent = $derived(Math.round(settings.volume));

  /** Телефон: уведомления всегда системные (шторка Android) — карточки, мелодии и панель задач есть только у ПК. */
  const touchOnly = isMobileMode();

  function save(patch: Parameters<typeof saveDeviceNotificationSettings>[0]) {
    return saveDeviceNotificationSettings(patch);
  }

  async function load() {
    hasBannerShell = hasDesktopBannerShell();
    await loadDeviceNotificationSettings();
    try {
      sounds = await listNotificationSounds();
    } catch {
      sounds = [];
    }
    try {
      const items = await buildCornerPreviewItems();
      if (items.length) stylePreviewPool = items;
    } catch {
      /* fallback samples */
    }
    loaded = true;
  }

  function onSoundChange(value: string) {
    save({ soundId: value });
    if (value !== 'off' && value !== 'system') void previewNotificationSound(value);
  }

  async function preview() {
    if (previewing) return;
    previewing = true;
    try {
      await previewNotificationSound(settings.soundId);
    } finally {
      setTimeout(() => { previewing = false; }, 400);
    }
  }

  onMount(() => void load());

  onDestroy(() => {
    cornerPreviewRequest += 1;
    void endNotificationCornerPreview();
  });
</script>

<div class="uiv2-settings">
  {#if !loaded}
    <p class="uiv2-settings__status">Загрузка…</p>
  {:else}
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Главное</h3>
      <p class="uiv2-settings__desc">
        {touchOnly ? 'Уведомления в шторке Android' : 'Уведомления на этом устройстве'}
      </p>
      <div class="uiv2-settings__group">
        <UiV2SettingsToggle
          label="Уведомления на устройстве"
          description={touchOnly
            ? 'Показывать новые серии, ответы и значки в шторке уведомлений'
            : 'Показывать уведомления вне приложения — на любом экране, где вы работаете'}
          checked={settings.desktopEnabled}
          onChange={(v) => save({ desktopEnabled: v })}
        />

        {#if !touchOnly}
        <UiV2SettingsToggle
          label="Системные уведомления"
          description="Уведомления операционной системы (Windows, macOS, Linux, Android)"
          checked={settings.useNativeNotifications}
          disabled={!deviceOn}
          onChange={(v) =>
            save({
              useNativeNotifications: v,
              customBannersEnabled: !v,
            })
          }
        />
        {/if}

        <details class="notif-advanced">
          <summary class="notif-advanced__summary">
            <span class="notif-advanced__title">Тестовое уведомление</span>
            {#if !canDeliver}
              <span class="notif-advanced__hint">Включите доставку уведомлений на этом устройстве</span>
            {/if}
          </summary>
          <div class="notif-advanced__body notif-test-actions">
            <UiV2Button label="Отправить пример новой серии" block disabled={!canDeliver}
              onclick={() => testKind('episode')}
            />
            <UiV2Button label="Отправить пример нового значка" block disabled={!canDeliver}
              onclick={() => testKind('achievement')}
            />
          </div>
        </details>
      </div>

      {#if !touchOnly}
      <div
        class="uiv2-settings__group"
        class:notif-app-banners--inactive={appNotifsInactive || !deviceOn}
        aria-disabled={appNotifsInactive || !deviceOn}
      >
        <UiV2SettingsToggle
          label="Звук"
          description="Проигрывать звук при новом уведомлении"
          checked={settings.soundEnabled}
          disabled={!deviceOn || appNotifsInactive}
          onChange={(v) => save({ soundEnabled: v })}
        />

        <UiV2Select
          appearance="row"
          label="Мелодия уведомления"
          options={soundOptions}
          value={settings.soundId}
          disabled={!deviceOn || !settings.soundEnabled || appNotifsInactive}
          onChange={onSoundChange}
        />
        <UiV2Button
          label={previewing ? 'Играет…' : 'Прослушать'}
          variant="chrome"
          size="sm"
          disabled={!deviceOn || !settings.soundEnabled || appNotifsInactive || settings.soundId === 'off' || settings.soundId === 'system'}
          onclick={() => void preview()}
        />

        <UiV2SettingsSlider
          label="Громкость уведомлений"
          value={volumePercent}
          valueText="{volumePercent}%"
          max={100}
          defaultValue={DEFAULT_NOTIFICATION_VOLUME}
          defaultText="{DEFAULT_NOTIFICATION_VOLUME}%"
          disabled={!deviceOn || !settings.soundEnabled || appNotifsInactive}
          onChange={(volume) => save({ volume })}
          onCommit={() => void previewNotificationSound(settings.soundId)}
        />
      </div>
      {/if}
    </section>

    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">События аккаунта</h3>
      <p class="uiv2-settings__desc">Какие события приходят в раздел уведомлений и на все ваши устройства</p>
      <div class="notif-prefs-wrap">
        <NotificationPreferencesPanel embedded />
      </div>
    </section>

    {#if !touchOnly}
    <section
      class="uiv2-settings__block"
      class:notif-app-banners--inactive={appNotifsInactive || !deviceOn}
    >
      <h3 class="uiv2-settings__title">Уведомления приложения</h3>
      <p class="uiv2-settings__desc">
        {appNotifsInactive
          ? 'Неактивно, пока включены системные уведомления ОС'
          : hasBannerShell
            ? 'Стиль карточки, угол экрана и размер стека'
            : 'Стиль карточки для уведомлений AnixApp'}
      </p>
      <div class="uiv2-settings__group">
        <UiV2Select
          appearance="row"
          label="Стиль карточки уведомления"
          options={styleOptions}
          value={settings.bannerStyle}
          disabled={!deviceOn || appNotifsInactive}
          onChange={onBannerStyleChange}
        />

        {#if hasBannerShell}
          <UiV2Select
            appearance="row"
            label="Сколько показывать сразу"
            description="Максимум карточек в стеке в выбранном углу"
            options={[1, 2, 3, 4, 5].map((count) => ({ value: String(count), label: String(count) }))}
            value={String(settings.bannerCount)}
            disabled={!deviceOn || appNotifsInactive}
            onChange={(value) => void saveAndPreviewCorner({ bannerCount: Number(value) })}
          />
          <figure class="notif-position">
            <div class="notif-position__screen" role="group" aria-label="Угол экрана для уведомлений">
              <span class="notif-position__monitor" aria-hidden="true">
                <svg width="64" height="44" viewBox="0 0 88 60" fill="none" focusable="false">
                  <rect x="2" y="2" width="84" height="50" rx="5" stroke="currentColor" stroke-width="2.5" opacity="0.55" />
                  <path d="M30 56h28m-14-4v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.55" />
                </svg>
              </span>
              <div class="notif-position__preview notif-position__preview--{previewCorner}" aria-hidden="true">
                {#each Array.from({ length: settings.bannerCount }) as _, index (index)}
                  <span class="notif-position__toast"></span>
                {/each}
              </div>
              {#each POSITIONS as position (position.id)}
                <button
                  type="button"
                  class="notif-position__corner notif-position__corner--{position.id}"
                  class:notif-position__corner--on={settings.position === position.id}
                  class:notif-position__corner--preview={previewCorner === position.id}
                  aria-label={position.label}
                  aria-pressed={settings.position === position.id}
                  disabled={!deviceOn || appNotifsInactive}
                  onmouseenter={() => { if (deviceOn && !appNotifsInactive) hoveredCorner = position.id; }}
                  onmouseleave={() => (hoveredCorner = null)}
                  onfocus={() => (hoveredCorner = position.id)}
                  onblur={() => (hoveredCorner = null)}
                  onclick={() => void saveAndPreviewCorner({ position: position.id })}
                >
                  <span class="notif-position__dot" aria-hidden="true"></span>
                </button>
              {/each}
            </div>
            <figcaption class="notif-position__caption">
              {POSITIONS.find((position) => position.id === previewCorner)?.label}
              · {settings.bannerCount} {settings.bannerCount === 1 ? 'баннер' : settings.bannerCount < 5 ? 'баннера' : 'баннеров'}
            </figcaption>
          </figure>
        {/if}
        <details class="notif-advanced notif-preview">
          <summary class="notif-advanced__summary">
            <span class="notif-advanced__title">Предпросмотр карточки</span>
          </summary>
          <div
            class="notif-style-live"
            data-style={settings.bannerStyle}
            data-position={settings.position}
            aria-live="polite"
          >
            <div
              class="notif-style-live__stack notif-style-live__stack--{settings.position.startsWith('top') ? 'top' : 'bottom'}"
            >
              {#each stylePreviewItems as sample (sample.kind + settings.bannerStyle)}
                {@const img = sample.image || PREVIEW_IMAGE}
                {@const fullMedia = sample.kind === 'episode' || sample.kind === 'related' || sample.kind === 'release'}
                {@const fullBadge = sample.kind === 'achievement' || sample.kind === 'badge'}
                <article
                  class="notif-style-live__card notif-style-live__card--{settings.bannerStyle}"
                  class:notif-style-live__card--full-media={settings.bannerStyle === 'full' && fullMedia}
                  class:notif-style-live__card--full-social={settings.bannerStyle === 'full' && !fullMedia && !fullBadge}
                  class:notif-style-live__card--full-badge={settings.bannerStyle === 'full' && fullBadge}
                  data-kind={sample.kind}
                >
                  {#if settings.bannerStyle === 'full' && fullMedia}
                    <span class="notif-style-live__media" style="background-image:url('{img}')"></span>
                    <span class="notif-style-live__scrim" aria-hidden="true"></span>
                  {:else if settings.bannerStyle === 'full' && fullBadge}
                    <span class="notif-style-live__badge" style="background-image:url('{img}')"></span>
                  {:else if settings.bannerStyle === 'full'}
                    <span class="notif-style-live__avatar" style="background-image:url('{img}')"></span>
                  {:else if settings.bannerStyle === 'compact' && fullBadge}
                    <span class="notif-style-live__wash" style="background-image:url('{img}')" aria-hidden="true"></span>
                    <span class="notif-style-live__tint" aria-hidden="true"></span>
                    <span class="notif-style-live__badge" style="background-image:url('{img}')"></span>
                  {:else if settings.bannerStyle === 'compact'}
                    <span class="notif-style-live__wash" style="background-image:url('{img}')" aria-hidden="true"></span>
                    <span class="notif-style-live__tint" aria-hidden="true"></span>
                    <span class="notif-style-live__thumb" style="background-image:url('{img}')"></span>
                  {:else}
                    <span class="notif-style-live__wash" style="background-image:url('{img}')" aria-hidden="true"></span>
                    <span class="notif-style-live__tint" aria-hidden="true"></span>
                  {/if}
                  <span class="notif-style-live__main">
                    <span class="notif-style-live__kind">{sample.title}</span>
                    <span class="notif-style-live__body">{@html emphasizeQuotes(sample.body)}</span>
                    {#if settings.bannerStyle === 'full'}
                      <span class="notif-style-live__time">только что</span>
                    {/if}
                  </span>
                </article>
              {/each}
            </div>
          </div>
        </details>
      </div>
    </section>
    {/if}

    <section
      class="uiv2-settings__block"
      class:uiv2-settings__block--dimmed={!deviceOn}
    >
      <details class="notif-advanced">
        <summary class="notif-advanced__summary">
          <span class="notif-advanced__title">Дополнительно</span>
          <span class="notif-advanced__hint">{touchOnly ? 'Текст и показ при открытом приложении' : 'Каналы доставки и поведение'}</span>
        </summary>

        <div class="notif-advanced__body">
          <div class="uiv2-settings__group">
            <UiV2SettingsToggle
              label="Текст в уведомлении"
              description="Показывать текст события; иначе только тип"
              checked={settings.showPreview}
              disabled={!deviceOn}
              onChange={(v) => save({ showPreview: v })}
            />

            <UiV2SettingsToggle
              label="Пока приложение открыто"
              description="Показывать уведомления и когда AnixApp уже в фокусе"
              checked={settings.showWhenFocused}
              disabled={!deviceOn}
              onChange={(v) => save({ showWhenFocused: v })}
            />

            {#if !touchOnly}
            <UiV2SettingsToggle
              label="Мигание в панели задач"
              description="Подсвечивать иконку, если окно не в фокусе"
              checked={settings.flashTaskbar}
              disabled={!deviceOn}
              onChange={(v) => save({ flashTaskbar: v })}
            />
            {/if}

            {#if hasBannerShell && !touchOnly}
              <div
                class="notif-app-banners-opts"
                class:notif-app-banners--inactive={appNotifsInactive && deviceOn}
                aria-disabled={appNotifsInactive && deviceOn}
              >
                <UiV2SettingsToggle
                  label="Карточки в углу"
                  description="Свои баннеры AnixApp поверх окон"
                  checked={settings.customBannersEnabled}
                  disabled={!deviceOn || appNotifsInactive}
                  onChange={(v) =>
                    save({
                      customBannersEnabled: v,
                      useNativeNotifications: !v,
                    })
                  }
                />

                <UiV2SettingsToggle
                  label="Поверх всех окон"
                  description="Карточки остаются видимыми поверх полноэкранных приложений"
                  checked={settings.alwaysOnTop}
                  disabled={!deviceOn || appNotifsInactive}
                  onChange={(v) => save({ alwaysOnTop: v })}
                />
              </div>
            {/if}
          </div>
        </div>
      </details>
    </section>
  {/if}
</div>
