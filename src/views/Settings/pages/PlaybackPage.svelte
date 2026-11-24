<script lang="ts">
  import { onMount } from 'svelte';
  import UiV2SettingsToggle from '../../../components/uikit-v2/UiV2SettingsToggle.svelte';
  import UiV2SettingsRow from '../../../components/uikit-v2/UiV2SettingsRow.svelte';
  import UiV2Select from '../../../components/uikit-v2/UiV2Select.svelte';
  import UiV2SettingsKey from '../../../components/uikit-v2/UiV2SettingsKey.svelte';
  import UiV2SettingsNumber from '../../../components/uikit-v2/UiV2SettingsNumber.svelte';
  import UiV2Button from '../../../components/uikit-v2/UiV2Button.svelte';
  import { showToast } from '../../../stores/toast';
  import {
    getMobilePlayerPrefs,
    resetMobilePlayerPrefs,
    setMobilePlayerPrefs,
    type MobilePlayerKind,
  } from '../../../utils/mobile-player';
  import {
    getPreferredExternalPlayerId,
    listExternalPlayers,
    setPreferredExternalPlayerId,
    type ExternalPlayerId,
    type ExternalPlayerOption,
  } from '../../../utils/player-integration';
  import {
    DEFAULT_PLAYER_HOTKEYS,
    REWIND_SECONDS_MAX,
    REWIND_SECONDS_MIN,
    REWIND_SECONDS_OPTIONS,
    SEEK_SECONDS_OPTIONS,
    formatHotkeyCode,
    formatSeekSeconds,
    isBindableKeyCode,
    normalizePlayerHotkeys,
    rebindPlayerHotkey,
    type PlayerHotkeyBindField,
    type PlayerHotkeysSettings,
  } from '../../../utils/player-hotkeys';
  import {
    ANIME4K_INTENSITIES,
    ANIME4K_TARGET_RES,
    ANIME4K_TYPES,
    MOBILE_ANIME4K_INTENSITIES,
    MOBILE_ANIME4K_TARGET_RES,
    MOBILE_ANIME4K_TYPES,
    clampAnime4kPresetForMobile,
    mapAnime4kPreset,
    normalizeAnime4kPreset,
    normalizeAnime4kTargetRes,
    type Anime4kIntensity,
    type Anime4kTargetRes,
    type Anime4kType,
  } from '../../Watch/core/anime4k-presets';
  import {
    SURROUND_GROUPS,
    normalizeSurroundMode,
    surroundModeDisplayLabel,
    surroundModeMeta,
    type SurroundMode,
  } from '../../Watch/core/surround-audio';
  import { initWebGpuAvailability, getWebGpuUnavailableReason } from '../../../utils/webgpu-availability.svelte';
  import { isMac } from '../../../utils/platform';
  import { hasAppSettingsStore, loadAppSettings, saveAppSettings } from '../../../utils/app-settings';
  import { isMobileMode } from '../../../platform/mobile';

  const modKey = isMac ? '⌘' : 'Ctrl';
  /** Телефон: клавиатурных биндов и окон-инструментов нет — остаются только интервалы перемотки. */
  const touchOnly = isMobileMode();

  type BindField = PlayerHotkeyBindField;

  const HOTKEY_ROWS: { field: BindField; title: string; desc: string }[] = [
    { field: 'seekBackCode', title: 'Перемотка назад', desc: 'Клавиша для прыжка назад на заданное время. По умолчанию — ←.' },
    { field: 'seekForwardCode', title: 'Перемотка вперёд', desc: 'Клавиша для прыжка вперёд на заданное время. По умолчанию — →.' },
    { field: 'rewindCode', title: 'Пропуск на заданное время', desc: 'Прыжок вперёд на время из блока «Время пропуска». По умолчанию — X.' },
    { field: 'playPauseCode', title: 'Пауза / воспроизведение', desc: 'По умолчанию — пробел.' },
    { field: 'volumeUpCode', title: 'Громче', desc: 'По умолчанию — ↑.' },
    { field: 'volumeDownCode', title: 'Тише', desc: 'По умолчанию — ↓.' },
    { field: 'fullscreenCode', title: 'Полный экран', desc: 'По умолчанию — F.' },
    { field: 'alwaysOnTopCode', title: 'Поверх всех окон', desc: 'Закрепить окно плеера поверх остальных. По умолчанию — P.' },
  ];

  let gpuAvailable = $state(false);
  let gpuReason = $state<string | null>(null);
  let upscaleType = $state<Anime4kType>('off');
  let upscaleIntensity = $state<Anime4kIntensity>('optimal');
  let upscaleTargetRes = $state<Anime4kTargetRes>('1080');
  let audioSurround = $state<SurroundMode>('off');
  let playerDebugOverlay = $state(false);
  let adaptiveQualityByWindow = $state(false);
  let hotkeys = $state<PlayerHotkeysSettings>({ ...DEFAULT_PLAYER_HOTKEYS });
  let capturing = $state<BindField | null>(null);
  let playbackLoaded = $state(false);

  const PLAYER_KIND_OPTIONS: { id: MobilePlayerKind; label: string; desc: string }[] = [
    { id: 'web', label: 'Веб-плеер', desc: 'Плеер источника, без установки' },
    { id: 'builtin', label: 'Встроенный', desc: 'Поток прямо в приложении' },
    { id: 'external', label: 'Сторонний', desc: 'VLC, mpv, PotPlayer…' },
  ];

  const SURROUND_OPTIONS = [
    { value: 'off', label: surroundModeDisplayLabel('off') },
    { value: 'equalizer', label: surroundModeDisplayLabel('equalizer', true) },
    ...SURROUND_GROUPS.flatMap((group) => group.modes.map((value) => ({
      value,
      label: surroundModeDisplayLabel(value, true),
      hint: group.label,
    }))),
  ];

  let playerPrefs = $state(getMobilePlayerPrefs());
  let preferredExternal = $state<ExternalPlayerId | null>(getPreferredExternalPlayerId());
  let externalPlayers = $state<ExternalPlayerOption[]>([]);
  let externalLoading = $state(false);

  function savePlayerPrefs(kind: MobilePlayerKind, ask: boolean) {
    setMobilePlayerPrefs({ kind, ask });
    playerPrefs = { kind, ask };
    window.dispatchEvent(new CustomEvent('anix:playerPrefsChanged', { detail: { kind, ask } }));
  }

  function selectPlayerKind(kind: MobilePlayerKind) {
    savePlayerPrefs(kind, playerPrefs.ask);
    if (kind === 'external' && externalPlayers.length === 0) void loadExternal(true);
  }

  function selectExternalPlayer(id: ExternalPlayerId) {
    preferredExternal = id;
    setPreferredExternalPlayerId(id);
  }

  async function loadExternal(fresh = false) {
    externalLoading = true;
    try {
      const res = await listExternalPlayers({ fresh });
      externalPlayers = res.installed;
      const stillInstalled = preferredExternal && externalPlayers.some((p) => p.id === preferredExternal);
      if (!stillInstalled) {
        // Не перезаписываем сохранённый выбор молча — main сам возьмёт первый установленный.
        preferredExternal = externalPlayers[0]?.id ?? null;
      }
    } catch {
      externalPlayers = [];
    } finally {
      externalLoading = false;
    }
  }

  function resetPlayerChoice() {
    resetMobilePlayerPrefs();
    setPreferredExternalPlayerId(null);
    playerPrefs = { kind: 'builtin', ask: true };
    preferredExternal = null;
    window.dispatchEvent(new CustomEvent('anix:playerPrefsChanged', { detail: { kind: 'builtin', ask: true } }));
    showToast('Выбор сброшен — окно выбора плеера появится при следующем запуске');
  }

  // Телефон и планшет: только лёгкие режимы, без «Максимум», разрешение обработки всегда 1080p
  const touchUi = isMobileMode();
  const typeOptions = touchUi ? MOBILE_ANIME4K_TYPES : ANIME4K_TYPES;
  const intensityOptions = touchUi ? MOBILE_ANIME4K_INTENSITIES : ANIME4K_INTENSITIES;
  const mappedUpscale = $derived(mapAnime4kPreset({ type: upscaleType, intensity: upscaleIntensity }));

  async function loadPlayback() {
    if (!hasAppSettingsStore()) return;
    gpuAvailable = await initWebGpuAvailability();
    gpuReason = gpuAvailable ? null : getWebGpuUnavailableReason();
    const settings = await loadAppSettings();
    const raw = normalizeAnime4kPreset(settings);
    const preset = touchUi ? clampAnime4kPresetForMobile(raw) : raw;
    upscaleType = preset.type;
    upscaleIntensity = preset.intensity;
    upscaleTargetRes = touchUi ? MOBILE_ANIME4K_TARGET_RES : normalizeAnime4kTargetRes(settings.upscaleTargetRes);
    audioSurround = normalizeSurroundMode(settings.audioSurround);
    playerDebugOverlay = settings.playerDebugOverlay === true;
    adaptiveQualityByWindow = settings.adaptiveQualityByWindow === true;
    hotkeys = normalizePlayerHotkeys(settings.playerHotkeys);
    playbackLoaded = true;
  }

  function saveUpscale() {
    const mapped = mapAnime4kPreset({ type: upscaleType, intensity: upscaleIntensity });
    saveAppSettings({
      upscaleEnabled: mapped.enabled,
      upscaleMode: mapped.mode,
      upscaleType,
      upscaleIntensity,
      upscaleTargetRes,
    });
    window.electron?.sendUpscaleSettings?.({
      upscaleEnabled: mapped.enabled,
      upscaleMode: mapped.mode,
      upscaleType,
      upscaleIntensity,
      upscaleTargetRes,
    });
    window.dispatchEvent(new CustomEvent('anix:upscaleChanged', {
      detail: {
        upscaleEnabled: mapped.enabled,
        upscaleMode: mapped.mode,
        upscaleType,
        upscaleIntensity,
        upscaleTargetRes,
      },
    }));
  }

  function saveSurround() {
    saveAppSettings({ audioSurround });
    window.dispatchEvent(new CustomEvent('anix:surroundChanged', {
      detail: { audioSurround },
    }));
  }

  function savePlayerDebug() {
    saveAppSettings({ playerDebugOverlay });
    window.dispatchEvent(new CustomEvent('anix:playerDebugChanged', { detail: { playerDebugOverlay } }));
  }

  function saveAdaptiveQuality() {
    saveAppSettings({ adaptiveQualityByWindow });
    window.dispatchEvent(new CustomEvent('anix:adaptiveQualityChanged', { detail: { adaptiveQualityByWindow } }));
  }

  function saveHotkeys(next: PlayerHotkeysSettings) {
    const normalized = normalizePlayerHotkeys(next);
    hotkeys = { ...normalized };
    void saveAppSettings({ playerHotkeys: { ...normalized } });
    window.electron?.sendPlayerHotkeys?.(normalized);
    window.dispatchEvent(new CustomEvent('anix:playerHotkeysChanged', { detail: { ...normalized } }));
  }

  function startCapture(field: BindField) {
    capturing = field;
  }

  function onCaptureKey(e: KeyboardEvent) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      capturing = null;
      return;
    }
    if (!isBindableKeyCode(e.code)) return;
    const field = capturing;
    capturing = null;
    saveHotkeys(rebindPlayerHotkey(hotkeys, field, e.code));
  }

  function onRewindSecondsChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      input.value = String(hotkeys.rewindSeconds);
      return;
    }
    saveHotkeys({ ...hotkeys, rewindSeconds: value });
    input.value = String(hotkeys.rewindSeconds);
  }

  onMount(() => {
    void loadPlayback();
    void loadExternal(false);
    window.addEventListener('keydown', onCaptureKey, true);
    return () => window.removeEventListener('keydown', onCaptureKey, true);
  });
</script>

<div class="uiv2-settings uiv2-settings--playback">
  {#if !hasAppSettingsStore()}
    <p class="uiv2-settings__status">Настройки воспроизведения недоступны: хранилище настроек отключено.</p>
  {:else if !playbackLoaded}
    <p class="uiv2-settings__status">Загрузка…</p>
  {:else}
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Способ воспроизведения</h3>
      <p class="uiv2-settings__desc">
        Чем открывать серии. Выбор запоминается; окно выбора можно вернуть кнопкой ниже.
      </p>
      <div class="uiv2-settings__group">
        <UiV2Select
          appearance="row"
          label="Плеер"
          description={PLAYER_KIND_OPTIONS.find((opt) => opt.id === playerPrefs.kind)?.desc}
          options={PLAYER_KIND_OPTIONS.map(({ id, label }) => ({ value: id, label }))}
          value={playerPrefs.kind}
          onChange={(value) => selectPlayerKind(value as MobilePlayerKind)}
        />

        {#if playerPrefs.kind === 'external'}
          {#if touchOnly}
            <p class="uiv2-settings__hint">Откроется системное окно выбора приложения — VLC, MX Player и другие установленные плееры.</p>
          {:else}
            {#if externalLoading}
              <p class="uiv2-settings__hint">Проверяем установленные плееры…</p>
            {:else if externalPlayers.length}
              <UiV2Select
                appearance="row"
                label="Сторонний плеер"
                options={externalPlayers.map(({ id, label }) => ({ value: id, label }))}
                value={preferredExternal}
                onChange={(value) => selectExternalPlayer(value as ExternalPlayerId)}
              />
            {:else}
              <p class="uiv2-settings__hint">
                Установленные плееры не найдены — поставьте VLC, mpv или PotPlayer и обновите список.
              </p>
            {/if}
            <UiV2Button
              label="Обновить список"
              variant="chrome"
              size="sm"
              onclick={() => void loadExternal(true)}
            />
          {/if}
        {/if}

        <UiV2SettingsToggle
          label="Спрашивать перед запуском"
          description="Показывать окно «Выберите плеер» перед каждой серией."
          checked={playerPrefs.ask}
          onChange={(checked) => savePlayerPrefs(playerPrefs.kind, checked)}
        />

        <UiV2SettingsRow
          title="Сбросить запомненный выбор"
          desc="Удалить сохранённый способ и сторонний плеер — окно выбора появится снова."
        >
          <UiV2Button label="Сбросить" variant="chrome" size="sm" onclick={resetPlayerChoice} />
        </UiV2SettingsRow>
      </div>
    </section>

    <!-- Anime4K — главное отличие плеера, поэтому первым -->
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Anime4K</h3>
      <p class="uiv2-settings__desc">
        Улучшает картинку в реальном времени через WebGPU: повышает резкость и убирает шум. Новых деталей не добавляет — проявляет имеющиеся.
      </p>
      {#if !gpuAvailable}
        <div class="uiv2-settings__notice uiv2-settings__notice--warn">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <line x1="10" y1="6" x2="10" y2="10.5" />
            <circle cx="10" cy="13.5" r=".7" fill="currentColor" stroke="none" />
          </svg>
          <span>
            На этом устройстве WebGPU недоступен — Anime4K не включится.
            {#if gpuReason}<br />{gpuReason}{/if}
          </span>
        </div>
      {/if}
      <div class="uiv2-settings__group">
        <UiV2Select
          appearance="row"
          label="Режим Anime4K"
          description={mappedUpscale.enabled ? ANIME4K_TYPES.find((mode) => mode.id === upscaleType)?.hint : undefined}
          value={upscaleType}
          options={typeOptions.map((opt) => ({
            value: opt.id,
            label: opt.label,
            hint: opt.recommended ? 'Рекомендуется' : undefined,
          }))}
          disabled={!gpuAvailable}
          onChange={(value) => { upscaleType = value as Anime4kType; saveUpscale(); }}
        />
        <UiV2Select
          appearance="row"
          label="Нагрузка на GPU"
          value={upscaleIntensity}
          options={intensityOptions.map(({ id, label }) => ({ value: id, label }))}
          disabled={!gpuAvailable || upscaleType === 'off'}
          onChange={(value) => { upscaleIntensity = value as Anime4kIntensity; saveUpscale(); }}
        />
        {#if !touchUi}
          <UiV2Select
            appearance="row"
            label="Разрешение обработки"
            value={upscaleTargetRes}
            options={ANIME4K_TARGET_RES.map(({ id, label }) => ({ value: id, label: id === 'auto' ? 'Авто · под окно' : label }))}
            description={upscaleTargetRes === 'auto' && upscaleType !== 'off' ? 'Подстраивается под размер окна.' : undefined}
            disabled={!gpuAvailable || upscaleType === 'off'}
            onChange={(value) => { upscaleTargetRes = value as Anime4kTargetRes; saveUpscale(); }}
          />
        {/if}
      </div>
    </section>

    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Перемотка</h3>
      <div class="uiv2-settings__group">
        <UiV2Select
          appearance="row"
          label="Шаг перемотки"
          description={touchOnly
            ? 'Кнопки перемотки в плеере. По умолчанию — 10 с.'
            : `Кнопки плеера и клавиши ${formatHotkeyCode(hotkeys.seekBackCode)} / ${formatHotkeyCode(hotkeys.seekForwardCode)}. По умолчанию — 10 с.`}
          value={String(hotkeys.seekSeconds)}
          options={SEEK_SECONDS_OPTIONS.map((value) => ({ value: String(value), label: formatSeekSeconds(value) }))}
          onChange={(value) => saveHotkeys({ ...hotkeys, seekSeconds: Number(value) })}
        />

        <UiV2Select
          appearance="row"
          label="Время пропуска"
          description={touchOnly
            ? 'Прыжок вперёд кнопкой пропуска. По умолчанию — 1:25.'
            : `Кнопка пропуска и клавиша ${formatHotkeyCode(hotkeys.rewindCode)}. По умолчанию — 1:25.`}
          value={String(hotkeys.rewindSeconds)}
          placeholder={formatSeekSeconds(hotkeys.rewindSeconds)}
          options={REWIND_SECONDS_OPTIONS.map((value) => ({ value: String(value), label: formatSeekSeconds(value) }))}
          onChange={(value) => saveHotkeys({ ...hotkeys, rewindSeconds: Number(value) })}
        />
        <UiV2SettingsNumber
          label="Своё время пропуска"
          unit="сек"
          min={REWIND_SECONDS_MIN}
          max={REWIND_SECONDS_MAX}
          value={hotkeys.rewindSeconds}
          onchange={onRewindSecondsChange}
        />
      </div>
    </section>

    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Объёмный звук</h3>
      <p class="uiv2-settings__desc">
        Кино HRTF, Imaging, Spatial, IRCAM и эквалайзер ±12 дБ. Тонкая настройка эквалайзера — в самом плеере.
      </p>
      <UiV2Select
        appearance="row"
        label="Режим звука"
        value={audioSurround}
        options={SURROUND_OPTIONS}
        description={audioSurround === 'off' ? undefined : surroundModeMeta(audioSurround)?.hint}
        onChange={(value) => { audioSurround = normalizeSurroundMode(value); saveSurround(); }}
      />
    </section>

    {#if !touchOnly}
      <section class="uiv2-settings__block">
        <h3 class="uiv2-settings__title">Горячие клавиши</h3>
        <p class="uiv2-settings__desc">Нажмите на строку, затем нажмите новую клавишу.</p>
        <div class="uiv2-settings__group">
          {#each HOTKEY_ROWS as row (row.field)}
            <UiV2SettingsKey
              label={row.title}
              description={row.desc}
              value={formatHotkeyCode(hotkeys[row.field])}
              capturing={capturing === row.field}
              onclick={() => startCapture(row.field)}
            />
          {/each}

          <UiV2SettingsToggle
            label="{modKey} + колёсико — скорость"
            description="Плавно ускорять и замедлять видео. Текущая скорость показывается на экране плеера."
            checked={hotkeys.ctrlWheelSpeed}
            onChange={(checked) => saveHotkeys({ ...hotkeys, ctrlWheelSpeed: checked })}
          />

          <UiV2SettingsRow
            title="Сбросить горячие клавиши"
            desc="Вернуть клавиши, шаг перемотки 10 с, пропуск 1:25 и {modKey} + колёсико."
          >
            <UiV2Button
              label="Сбросить"
              variant="chrome"
              size="sm"
              onclick={() => saveHotkeys({ ...DEFAULT_PLAYER_HOTKEYS })}
            />
          </UiV2SettingsRow>
        </div>
      </section>
    {/if}

    {#if !touchOnly}
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Качество потока</h3>
      <div class="uiv2-settings__group">
        <UiV2SettingsToggle
          label="Качество по размеру окна"
          description="Автоматическое снижение разрешения при уменьшении окна плеера: 1080 → 720 → 480 → 360. Удобно для режима «поверх всех окон». По умолчанию выключено."
          checked={adaptiveQualityByWindow}
          onChange={(checked) => {
            adaptiveQualityByWindow = checked;
            saveAdaptiveQuality();
          }}
        />
      </div>
    </section>
    {/if}

    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Отладка плеера</h3>
      <div class="uiv2-settings__group">
        <UiV2SettingsToggle
          label="HUD на экране плеера"
          description="Разрешение потока и окна, битрейт HLS, кадры, состояние Anime4K / WebGPU и размер canvas."
          checked={playerDebugOverlay}
          onChange={(checked) => {
            playerDebugOverlay = checked;
            savePlayerDebug();
          }}
        />
      </div>
    </section>

    {#if !touchOnly}
    <section class="uiv2-settings__block">
      <h3 class="uiv2-settings__title">Инструменты разработки</h3>
      <div class="uiv2-settings__group">
        <UiV2SettingsRow
          title="Предпросмотр моделей"
          desc="Инструмент для сравнения фильтров (Deblur, Denoise, Restore, Upscale) на тестовых кадрах со слайдером «до/после» в реальном времени."
        >
          <UiV2Button
            label="Открыть"
            variant="primary"
            size="sm"
            onclick={() => window.electron?.openUpscaleTool?.()}
          />
        </UiV2SettingsRow>
      </div>
    </section>
    {/if}
  {/if}
</div>

<style lang="scss">
</style>
