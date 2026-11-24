<script lang="ts">
  import UiV2Button from '../../../components/uikit-v2/UiV2Button.svelte';
  import UiV2OutlinedField from '../../../components/uikit-v2/UiV2OutlinedField.svelte';
  import UiV2RoundButton from '../../../components/uikit-v2/UiV2RoundButton.svelte';
  import UiV2Select from '../../../components/uikit-v2/UiV2Select.svelte';
  import UiV2SettingsKey from '../../../components/uikit-v2/UiV2SettingsKey.svelte';
  import UiV2SettingsNumber from '../../../components/uikit-v2/UiV2SettingsNumber.svelte';
  import UiV2SettingsRow from '../../../components/uikit-v2/UiV2SettingsRow.svelte';
  import UiV2SettingsSlider from '../../../components/uikit-v2/UiV2SettingsSlider.svelte';
  import UiV2SettingsToggle from '../../../components/uikit-v2/UiV2SettingsToggle.svelte';
  import { iconChevronDown, iconChevronUp } from '../../../components/icons';
  import UiV2ZoomScaleSlider from '../../../components/uikit-v2/UiV2ZoomScaleSlider.svelte';
  import type { CardLayout } from '../../../prefs';
  import { BUILT_IN_THEMES } from '../../../services/themes';
  import { DEFAULT_NOTIFICATION_VOLUME } from '../../../stores/device-notifications';
  import { DEFAULT_ZOOM, type ZoomLevel } from '../../../utils/zoom';

  const bookmarkOptions = [
    { value: 'watching', label: 'Смотрю' },
    { value: 'planned', label: 'В планах' },
    { value: 'collections', label: 'Коллекции' },
  ];
  const diagnosticRows = [
    { key: 'Аппаратное ускорение', value: 'Включено' },
    { key: 'WebGPU', value: 'Доступно' },
    { key: 'API', value: '42 мс' },
  ];

  const defaults = {
    layout: 'mini' as CardLayout,
    theme: 'auto',
    zoom: DEFAULT_ZOOM as ZoomLevel,
    bookmarks: 'watching',
    autoNext: true,
    seek: 10,
    skip: 85 as number | undefined,
    shortcut: 'K',
    sound: true,
    volume: 65,
    discordTitle: true,
    discordEpisode: false,
    nickname: '',
    social: '',
    server: 'main',
    diagnosticsQuery: '',
  };
  const initialNavigation = ['Главная', 'Коллекции', 'Закладки'];
  let demo = $state({ ...defaults });
  let navigation = $state([...initialNavigation]);
  let capturing = $state(false);
  let dragging = $state<number | null>(null);
  let checkedUpdates = $state(false);
  const visibleDiagnostics = $derived(
    diagnosticRows.filter(({ key, value }) =>
      `${key} ${value}`.toLowerCase().includes(demo.diagnosticsQuery.trim().toLowerCase()),
    ),
  );
  const changed = $derived(
    Object.keys(defaults).some((key) => demo[key as keyof typeof defaults] !== defaults[key as keyof typeof defaults])
      || navigation.some((item, index) => item !== initialNavigation[index]) || checkedUpdates,
  );

  function reset() {
    demo = { ...defaults };
    navigation = [...initialNavigation];
    capturing = false;
    checkedUpdates = false;
  }

  function captureShortcut(event: KeyboardEvent) {
    if (!capturing || event.key === 'Tab') return;
    event.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    capturing = false;
    if (event.key === 'Escape') return;
    const modifiers = [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Meta',
    ].filter(Boolean);
    const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    demo.shortcut = [...modifiers, key].join(' + ');
  }

  function moveNavigation(from: number, to: number) {
    if (from === to) return;
    const next = [...navigation];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    navigation = next;
  }

  function dropNavigation(event: DragEvent, to: number) {
    event.preventDefault();
    if (dragging !== null) moveNavigation(dragging, to);
    dragging = null;
  }
</script>

<div class="uiv2-settings settings-design">
  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Внешний вид</h3>
    <div class="uiv2-settings__group">
      <UiV2Select
        appearance="row"
        label="Тема оформления"
        options={BUILT_IN_THEMES.map(({ id, name }) => ({ value: id, label: name }))}
        value={demo.theme}
        onChange={(value) => (demo.theme = value)}
      />
      <UiV2Select
          appearance="row"
          label="Вкладка закладок по умолчанию"
          options={bookmarkOptions}
          value={demo.bookmarks}
          onChange={(value) => (demo.bookmarks = value)}
        />
      <UiV2ZoomScaleSlider value={demo.zoom} onChange={(value) => (demo.zoom = value)} />
    </div>
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Списки релизов</h3>
    <UiV2Select
      appearance="row"
      label="Вид списка"
      options={[{ value: 'wide', label: 'Списком' }, { value: 'mini', label: 'Карточками' }]}
      value={demo.layout}
      onChange={(value) => (demo.layout = value as CardLayout)}
    />
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Воспроизведение</h3>
    <div class="uiv2-settings__group">
      <UiV2SettingsToggle
        label="Автопереход к следующей серии" description="После окончания текущей серии"
        checked={demo.autoNext}
        onChange={(value) => (demo.autoNext = value)}
      />
      <UiV2Select
        appearance="row"
        label="Шаг перемотки"
        value={String(demo.seek)}
        options={[5, 10, 15, 30].map((value) => ({ value: String(value), label: `${value} сек` }))}
        onChange={(value) => (demo.seek = Number(value))}
      />
      <UiV2SettingsNumber label="Длительность пропуска" unit="сек" min={1} max={300} bind:value={demo.skip} />
      <UiV2SettingsKey
        label="Пауза и воспроизведение"
        value={demo.shortcut}
        {capturing}
        onclick={() => (capturing = !capturing)}
        onkeydown={captureShortcut}
        onblur={() => (capturing = false)}
      />
    </div>
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Уведомления и Discord</h3>
    <div class="uiv2-settings__group">
      <UiV2SettingsToggle
        label="Звук уведомлений"
        checked={demo.sound} onChange={(value) => (demo.sound = value)}
      />
      <UiV2SettingsSlider
        label="Громкость уведомлений"
        value={demo.volume}
        valueText="{demo.volume}%"
        max={100}
        defaultValue={DEFAULT_NOTIFICATION_VOLUME}
        defaultText="{DEFAULT_NOTIFICATION_VOLUME}%"
        disabled={!demo.sound}
        onChange={(volume) => (demo.volume = volume)}
      />
      <UiV2SettingsRow title="Что показывать в Discord" stack>
        <div class="uiv2-settings__check-grid">
          <label class="uiv2-settings__check">
            <input type="checkbox" bind:checked={demo.discordTitle} />
            <span class="uiv2-settings__check-box" aria-hidden="true"></span>
            <span class="uiv2-settings__check-text"><span class="uiv2-settings__check-name">Название релиза</span></span>
          </label>
          <label class="uiv2-settings__check">
            <input type="checkbox" bind:checked={demo.discordEpisode} />
            <span class="uiv2-settings__check-box" aria-hidden="true"></span>
            <span class="uiv2-settings__check-text"><span class="uiv2-settings__check-name">Номер серии</span></span>
          </label>
        </div>
      </UiV2SettingsRow>
    </div>
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Аккаунт</h3>
    <div class="uiv2-settings__group uiv2-settings__group--pad">
      <UiV2OutlinedField label="Никнейм" bind:value={demo.nickname} maxlength={32} />
      <UiV2OutlinedField label="Ссылка на профиль" type="url" bind:value={demo.social} />
    </div>
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Навигация</h3>
    <ul class="uiv2-settings__group demo-navigation">
      {#each navigation as item, index (item)}
        <li
          class="uiv2-settings__row"
          draggable="true"
          ondragstart={(event) => {
            dragging = index;
            event.dataTransfer?.setData('text/plain', item);
          }}
          ondragend={() => (dragging = null)}
          ondragover={(event) => { if (dragging !== null) event.preventDefault(); }}
          ondrop={(event) => dropNavigation(event, index)}
        >
          <span class="uiv2-settings__row-title">{item}</span>
          <div class="demo-actions">
            <UiV2RoundButton size="sm" label={`Выше: ${item}`} disabled={index === 0} onclick={() => moveNavigation(index, index - 1)}>
              {@html iconChevronUp(16)}
            </UiV2RoundButton>
            <UiV2RoundButton size="sm" label={`Ниже: ${item}`} disabled={index === navigation.length - 1} onclick={() => moveNavigation(index, index + 1)}>
              {@html iconChevronDown(16)}
            </UiV2RoundButton>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Подключение и обновления</h3>
    <div class="uiv2-settings__group">
      <UiV2Select
          appearance="row"
          label="API-эндпоинт"
          options={[
            { value: 'main', label: 'Основной сервер', status: 'good', hint: '42 мс' },
            { value: 'backup', label: 'Резервный сервер', status: 'medium', hint: '148 мс' },
            { value: 'offline', label: 'Зеркало', status: 'offline', disabled: true },
          ]}
          value={demo.server}
          onChange={(value) => (demo.server = value)}
        />
      <UiV2SettingsRow title="Обновления">
        <UiV2Button label="Проверить" variant="primary" onclick={() => (checkedUpdates = true)} />
      </UiV2SettingsRow>
      {#if checkedUpdates}
        <p class="uiv2-settings__status demo-status" role="status">В демо установлена последняя версия</p>
      {/if}
    </div>
  </section>

  <section class="uiv2-settings__block">
    <h3 class="uiv2-settings__title">Диагностика</h3>
    <div class="uiv2-settings__group uiv2-settings__group--pad">
      <UiV2OutlinedField label="Поиск по диагностике" type="search" bind:value={demo.diagnosticsQuery} />
      {#if visibleDiagnostics.length}
        <dl class="uiv2-settings__diag">
          {#each visibleDiagnostics as row (row.key)}
            <div class="uiv2-settings__diag-row">
              <dt class="uiv2-settings__diag-key">{row.key}</dt>
              <dd class="uiv2-settings__diag-val"><span class="uiv2-settings__pill">{row.value}</span></dd>
            </div>
          {/each}
        </dl>
      {:else}
        <p class="uiv2-settings__status" role="status">Ничего не найдено</p>
      {/if}
    </div>
  </section>

  <div>
    <UiV2Button label="Сбросить значения" disabled={!changed} onclick={reset} />
  </div>
</div>

<style>
  .demo-navigation {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .demo-actions {
    display: flex;
    gap: 0.4rem;
  }

  .demo-status {
    padding: 0 1rem 0.85rem;
  }
</style>
