<script lang="ts">
  import { iconRotateCcw } from '../icons';

  let {
    label,
    value,
    valueText,
    min = 0,
    max,
    defaultValue,
    defaultText,
    disabled = false,
    onChange,
    onCommit,
  }: {
    label: string;
    value: number;
    valueText: string;
    min?: number;
    max: number;
    defaultValue: number;
    defaultText: string;
    disabled?: boolean;
    onChange: (value: number) => void;
    onCommit?: (value: number) => void;
  } = $props();

  const fraction = (position: number) => max > min ? (position - min) / (max - min) : 0;
  const resetLabel = $derived(`Сбросить «${label}» до ${defaultText}`);
</script>

<div class="uiv2-setting-control settings-slider" class:settings-slider--disabled={disabled}>
  <label class="settings-slider__label">
    <span class="settings-slider__copy">
      <span class="uiv2-setting-control__label">{label}</span>
      <span class="uiv2-setting-control__value" aria-hidden="true">{valueText}</span>
    </span>
    <span class="settings-slider__track" style:--slider-fill={fraction(value)} style:--slider-default={fraction(defaultValue)}>
      <input
        type="range"
        {min}
        {max}
        {value}
        {disabled}
        aria-label={label}
        aria-valuetext={valueText}
        oninput={(event) => onChange(event.currentTarget.valueAsNumber)}
        onchange={(event) => onCommit?.(event.currentTarget.valueAsNumber)}
      />
    </span>
  </label>
  <button
    type="button"
    class="settings-slider__reset"
    aria-label={resetLabel}
    title={resetLabel}
    disabled={disabled || value === defaultValue}
    onclick={() => {
      onChange(defaultValue);
      onCommit?.(defaultValue);
    }}
  >
    {@html iconRotateCcw(16)}
  </button>
</div>

<style>
  .settings-slider {
    --slider-thumb: 0.85rem;
    --slider-height: 2.5rem;
    --slider-accent: var(--uikit-v2-accent);
    gap: 0.45rem;
  }

  .settings-slider__label {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr) minmax(5rem, 1.35fr);
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .settings-slider--disabled .settings-slider__label {
    opacity: 0.5;
  }

  .settings-slider__track input:disabled {
    cursor: default;
  }

  .settings-slider__copy {
    display: grid;
    gap: 0.2rem;
  }

  .settings-slider__track {
    position: relative;
    display: block;
    height: var(--slider-height);
    overflow: hidden;
    border-radius: 0.45rem;
    background: var(--uiv2-chrome-bg);
  }

  .settings-slider__track::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--slider-thumb) / 2 + (100% - var(--slider-thumb)) * var(--slider-fill));
    background: color-mix(in srgb, var(--slider-accent) 35%, transparent);
    content: '';
    pointer-events: none;
  }

  .settings-slider__track::after {
    position: absolute;
    top: 50%;
    left: calc(var(--slider-thumb) / 2 + (100% - var(--slider-thumb)) * var(--slider-default));
    width: 2px;
    height: 0.65rem;
    border-radius: 2px;
    background: var(--uiv2-fg-muted);
    transform: translate(-50%, -50%);
    content: '';
    pointer-events: none;
  }

  .settings-slider__track input {
    position: relative;
    z-index: 1;
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    appearance: none;
    background: transparent;
    cursor: ew-resize;
  }

  .settings-slider__track input:focus-visible {
    outline: 2px solid var(--slider-accent);
    outline-offset: -2px;
    border-radius: inherit;
  }

  .settings-slider__track input::-webkit-slider-runnable-track {
    height: var(--slider-height);
    background: transparent;
  }

  .settings-slider__track input::-webkit-slider-thumb {
    width: var(--slider-thumb);
    height: calc(var(--slider-height) - 0.45rem);
    margin-top: 0.225rem;
    border: 0;
    border-radius: 0.35rem;
    appearance: none;
    background: var(--slider-accent);
  }

  .settings-slider__track input::-moz-range-track {
    height: var(--slider-height);
    background: transparent;
  }

  .settings-slider__track input::-moz-range-thumb {
    width: var(--slider-thumb);
    height: calc(var(--slider-height) - 0.45rem);
    border: 0;
    border-radius: 0.35rem;
    background: var(--slider-accent);
  }

  .settings-slider__reset {
    display: grid;
    flex: 0 0 auto;
    width: 2rem;
    height: var(--slider-height);
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 0.45rem;
    background: transparent;
    color: var(--uiv2-fg-muted);
    cursor: pointer;
  }

  .settings-slider__reset:hover:not(:disabled) {
    background: var(--uiv2-hover-bg);
    color: var(--uikit-v2-text);
  }

  .settings-slider__reset:focus-visible {
    outline: 2px solid var(--slider-accent);
    outline-offset: -2px;
  }

  .settings-slider__reset:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
