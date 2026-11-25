<script lang="ts">
  import { tick } from 'svelte';
  import { scale, slide } from 'svelte/transition';
  import { cubicIn, cubicOut, quintOut } from 'svelte/easing';
  import { revealFilterList } from '../../utils/revealFilterList';
  import { portal } from '../../actions/portal';
  import { uiv2CustomScroll } from '../../actions/uiv2CustomScroll';
  import { iconArrowUpDown, iconCheck, iconChevronDown } from '../icons';

  export type UiV2SelectStatus = 'good' | 'medium' | 'bad' | 'offline' | 'neutral';

  export type UiV2SelectOption = {
    value: string;
    label: string;
    /** Подпись под label */
    desc?: string;
    /** Мета справа (ping, «42 ms») */
    hint?: string;
    /** HTML-иконка */
    icon?: string;
    /** Цветовой индикатор слева */
    status?: UiV2SelectStatus;
    /** Предупреждение под desc */
    warning?: string;
    disabled?: boolean;
  };

  type Props = {
    label?: string;
    description?: string;
    placeholder?: string;
    options?: UiV2SelectOption[];
    value?: string | null;
    disabled?: boolean;
    id?: string;
    class?: string;
    /** Доп. класс списка вариантов */
    panelClass?: string;
    /** Компактный триггер — только иконка (тулбары) */
    compact?: boolean;
    /** Крупный заголовок без рамки (сортировка ленты как на Android). */
    appearance?: 'default' | 'title' | 'row';
    listPlacement?: 'inline' | 'overlay';
    showSelectedDetails?: boolean;
    /** Доступное имя, если нет видимого label */
    ariaLabel?: string;
    onChange?: (value: string) => void;
  };

  let {
    label,
    description,
    placeholder = 'Выберите…',
    options = [],
    value = $bindable(null),
    disabled = false,
    id = `uiv2-select-${Math.random().toString(36).slice(2, 9)}`,
    class: className = '',
    panelClass = '',
    compact = false,
    appearance = 'default',
    listPlacement,
    showSelectedDetails = true,
    ariaLabel,
    onChange,
  }: Props = $props();

  const isTitle = $derived(appearance === 'title');
  const isRow = $derived(appearance === 'row' && !compact);
  const isInline = $derived(listPlacement ? listPlacement === 'inline' : isRow);

  const GAP = 8;
  const EDGE = 10;

  let triggerEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let panelLeft = $state(0);
  let panelTop = $state(0);
  let panelWidth = $state(0);
  let panelMaxHeight = $state(264);
  let openDown = $state(true);
  let overlayFromRight = $state(false);
  let originY = $state('0%');

  const selected = $derived(options.find((o) => o.value === value) ?? null);
  const listboxId = $derived(`${id}-listbox`);
  const showLeading = $derived(options.some((o) => o.status || o.icon));
  const compactTitle = $derived(
    selected?.desc ? `${selected.label} · ${selected.desc}` : (selected?.label ?? placeholder),
  );

  function animateOverlayList(node: HTMLElement, { closing = false } = {}) {
    if (listPlacement === 'overlay') return revealFilterList(node, { upward: !openDown, fromRight: overlayFromRight, closing });
    return scale(node, { duration: 200, start: 0.97, easing: cubicOut });
  }

  function animateInlineList(node: HTMLElement, { closing = false } = {}) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const layout = slide(node, {
      duration: reducedMotion ? 0 : closing ? 150 : 260,
      easing: closing ? cubicIn : quintOut,
    });

    return {
      ...layout,
      css: (progress: number, remaining: number) =>
        `${layout.css?.(progress, remaining) ?? ''}opacity:${progress ** 2};transform:translateY(${-5 * remaining}px);`,
    };
  }

  function isTriggerVisible(): boolean {
    if (!triggerEl) return false;
    const r = triggerEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  }

  function positionOverlay(rect: DOMRect) {
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    openDown = below >= above;
    originY = openDown ? '0%' : '100%';
    panelMaxHeight = Math.max(0, openDown ? below : above);
    panelWidth = Math.min(window.innerWidth - EDGE * 2, Math.max(rect.width, 240));
    overlayFromRight = rect.left > window.innerWidth - rect.right;
    const left = overlayFromRight ? rect.right - panelWidth : rect.left;
    panelLeft = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - panelWidth));
    panelTop = openDown ? rect.bottom + GAP : window.innerHeight - rect.top + GAP;
  }

  async function updatePanelPosition() {
    if (!triggerEl || !panelEl) return;
    await tick();

    const rect = triggerEl.getBoundingClientRect();
    if (listPlacement === 'overlay') {
      positionOverlay(rect);
      return;
    }
    panelWidth = compact || isTitle ? 0 : rect.width;

    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    // Предпочитаем вниз, чтобы панель реже накрывала поля выше (поиск)
    const listEl = panelEl.querySelector<HTMLElement>('.uiv2-select__list');
    const need = Math.min(listEl?.scrollHeight || panelEl.scrollHeight || 180, 260);
    openDown = spaceBelow >= Math.min(need, 140) || spaceBelow >= spaceAbove;
    originY = openDown ? '0%' : '100%';
    panelMaxHeight = Math.max(120, openDown ? spaceBelow : spaceAbove);

    panelLeft = rect.left;
    panelTop = openDown ? rect.bottom + GAP : rect.top - GAP - Math.min(panelEl.offsetHeight, panelMaxHeight);

    const panelRect = panelEl.getBoundingClientRect();
    if (panelRect.right > window.innerWidth - EDGE) {
      panelLeft = Math.max(EDGE, window.innerWidth - EDGE - panelRect.width);
    }
    if (panelRect.left < EDGE) {
      panelLeft = EDGE;
    }

    const nextRect = panelEl.getBoundingClientRect();
    if (compact) {
      panelLeft = Math.max(EDGE, rect.right - nextRect.width);
    }
    if (nextRect.top < EDGE) {
      panelTop = EDGE;
    } else if (nextRect.bottom > window.innerHeight - EDGE) {
      panelTop = Math.max(EDGE, window.innerHeight - EDGE - nextRect.height);
    }
  }

  async function openPanel() {
    if (disabled || open) return;
    if (listPlacement === 'overlay' && triggerEl) positionOverlay(triggerEl.getBoundingClientRect());
    open = true;
    if (isInline) return;
    await tick();
    await updatePanelPosition();
    requestAnimationFrame(() => updatePanelPosition());
  }

  function closePanel() {
    open = false;
  }

  function togglePanel(e: MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    if (open) closePanel();
    else openPanel();
  }

  function selectOption(opt: UiV2SelectOption) {
    if (opt.disabled) return;
    value = opt.value;
    onChange?.(opt.value);
    closePanel();
    if (isRow) triggerEl?.focus({ preventScroll: true });
  }

  function onOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closePanel();
  }

  function onDocumentClick(e: MouseEvent) {
    const target = e.target as Node;
    if (triggerEl?.contains(target) || panelEl?.contains(target)) return;
    closePanel();
  }

  function onDocumentKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      closePanel();
      triggerEl?.focus();
    }
  }

  function onScrollOrResize(e: Event) {
    if (!open) return;
    // Своя прокрутка списка положение панели не меняет; пересчёт на каждый шаг заставлял её дёргаться
    if (e.target instanceof Node && panelEl?.contains(e.target)) return;
    if (!isTriggerVisible()) {
      closePanel();
      return;
    }
    updatePanelPosition();
  }

  $effect(() => {
    if (!open) return;
    const floating = !isInline;
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeydown, true);
    if (floating) {
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize);
    }
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  });
</script>

{#snippet optionList()}
  <div
    class="uiv2-select__scroll uiv2-scroll-area uiv2-scroll-area--y"
    use:uiv2CustomScroll={{ axis: 'y', viewportSelector: '.uiv2-select__list' }}
  >
    <ul class="uiv2-select__list uiv2-scroll-area__viewport" data-uiv2-scroll>
      {#each options as opt (opt.value)}
        <li class="uiv2-select__item">
          <button
            type="button"
            class="uiv2-select__option"
            class:uiv2-select__option--selected={value === opt.value}
            class:uiv2-select__option--disabled={opt.disabled}
            class:uiv2-select__option--with-desc={!!opt.desc || !!opt.warning}
            role="option"
            aria-selected={value === opt.value}
            disabled={opt.disabled}
            onclick={() => selectOption(opt)}
          >
            {#if showLeading}
              <span class="uiv2-select__option-leading">
                {#if opt.status}
                  <span class="uiv2-status-dot uiv2-status-dot--{opt.status}" aria-hidden="true"></span>
                {/if}
                {#if opt.icon}
                  <span class="uiv2-select__option-icon">{@html opt.icon}</span>
                {/if}
              </span>
            {/if}
            <span class="uiv2-select__option-body">
              <span class="uiv2-select__option-label">{opt.label}</span>
              {#if opt.desc}
                <span class="uiv2-select__option-desc">{opt.desc}</span>
              {/if}
              {#if opt.warning}
                <span class="uiv2-select__option-warning">{opt.warning}</span>
              {/if}
            </span>
            <span class="uiv2-select__option-trailing">
              {#if value !== opt.value && opt.hint}
                <span class="uiv2-select__option-hint">{opt.hint}</span>
              {/if}
              {#if value === opt.value}
                <span class="uiv2-select__option-check" aria-hidden="true">
                  {@html iconCheck(16)}
                </span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="uiv2-scroll-area__v-track" aria-hidden="true">
      <div class="uiv2-scroll-area__v-thumb"></div>
    </div>
  </div>
{/snippet}

<div
  class="uiv2-select {className}"
  class:uiv2-select--disabled={disabled}
  class:uiv2-select--open={open}
  class:uiv2-select--compact={compact}
  class:uiv2-select--title={isTitle}
  class:uiv2-select--row={isRow}
>
  {#if label && !compact && !isRow}
    <label class="uiv2-select__label" for="{id}-trigger">{label}</label>
  {/if}

  <div class="uiv2-select__field">
    <button
      bind:this={triggerEl}
      id="{id}-trigger"
      type="button"
      class="uiv2-select__trigger"
      class:uiv2-select__trigger--with-desc={showSelectedDetails && !!selected?.desc && !compact}
      class:uiv2-select__trigger--compact={compact}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      aria-label={isRow && (ariaLabel || label)
        ? `${ariaLabel || label}, ${selected?.label ?? placeholder}`
        : ariaLabel ?? (compact ? compactTitle : undefined)}
      aria-describedby={isRow && description ? `${id}-description` : undefined}
      title={compact ? compactTitle : undefined}
      {disabled}
      onclick={togglePanel}
    >
      {#if compact}
        <span class="uiv2-select__compact-icon" aria-hidden="true">
          {@html iconArrowUpDown(18)}
        </span>
      {:else}
        {#if isRow && label}
          <span class="uiv2-select__row-copy">
            <span class="uiv2-select__row-label">{label}</span>
            {#if description}<span id="{id}-description" class="uiv2-select__row-description">{description}</span>{/if}
          </span>
        {/if}
        <span class="uiv2-select__value">
          {#if selected}
            <span class="uiv2-select__value-main">
              {#if showSelectedDetails && (selected.status || selected.icon)}
                <span class="uiv2-select__value-leading">
                  {#if selected.status}
                    <span class="uiv2-status-dot uiv2-status-dot--{selected.status}" aria-hidden="true"></span>
                  {/if}
                  {#if selected.icon}
                    <span class="uiv2-select__option-icon">{@html selected.icon}</span>
                  {/if}
                </span>
              {/if}
              <span class="uiv2-select__value-label">{selected.label}</span>
              {#if selected.hint}
                <span class="uiv2-select__value-hint">{selected.hint}</span>
              {/if}
            </span>
            {#if showSelectedDetails && selected.desc}
              <span class="uiv2-select__value-desc">{selected.desc}</span>
            {/if}
          {:else}
            <span class="uiv2-select__value-label uiv2-select__value-label--placeholder">{placeholder}</span>
          {/if}
        </span>
        <span class="uiv2-select__chevron" aria-hidden="true">
          {@html iconChevronDown(16)}
        </span>
      {/if}
    </button>
  </div>
  {#if open && isInline}
    <div
      class="uiv2-select__inline"
      in:animateInlineList
      out:animateInlineList={{ closing: true }}
    >
      <div
        bind:this={panelEl}
        id={listboxId}
        class="uiv2-select__panel uiv2-select__panel--inline {panelClass}"
        class:uiv2-select__panel--with-leading={showLeading}
        role="listbox"
        tabindex="-1"
        aria-labelledby="{id}-trigger"
        inert={!open}
      >
        {@render optionList()}
      </div>
    </div>
  {/if}
</div>

{#if open && !isInline}
  <div
    class="uiv2-select__overlay"
    style:pointer-events={listPlacement === 'overlay' ? 'none' : undefined}
    data-uiv2-select-portal
    use:portal
    role="presentation"
    onclick={onOverlayClick}
  >
    <div
      bind:this={panelEl}
      id={listboxId}
      class="uiv2-select__panel {panelClass}"
      class:uiv2-select__panel--up={!openDown}
      class:uiv2-select__panel--filter={listPlacement === 'overlay'}
      class:uiv2-select__panel--with-leading={showLeading}
      class:uiv2-select__panel--title={isTitle}
      role="listbox"
      tabindex="-1"
      aria-labelledby="{id}-trigger"
      style:left="{panelLeft}px"
      style:top={listPlacement === 'overlay' && !openDown ? undefined : `${panelTop}px`}
      style:bottom={listPlacement === 'overlay' && !openDown ? `${panelTop}px` : undefined}
      style:width={compact || isTitle ? undefined : `${panelWidth}px`}
      style:min-width={compact ? '15rem' : isTitle ? '13rem' : undefined}
      style:max-height="{panelMaxHeight}px"
      style:transform-origin="50% {originY}"
      in:animateOverlayList
      out:animateOverlayList={{ closing: true }}
      inert={!open}
      onpointerdown={(e) => e.stopPropagation()}
    >
      {@render optionList()}
    </div>
  </div>
{/if}
