<script lang="ts">
  let {
    label,
    description,
    checked = false,
    disabled = false,
    onChange,
  }: {
    label: string;
    description?: string;
    checked?: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
  } = $props();

  const id = $props.id();
</script>

<label class="uiv2-setting-control settings-toggle" class:settings-toggle--disabled={disabled}>
  <span class="uiv2-setting-control__label">
    <span id="{id}-label">{label}</span>
    {#if description}
      <span id="{id}-description" class="uiv2-setting-control__description">{description}</span>
    {/if}
  </span>
  <input
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    aria-labelledby="{id}-label"
    aria-describedby={description ? `${id}-description` : undefined}
    onchange={(event) => onChange(event.currentTarget.checked)}
  />
  <span class="settings-toggle__status" aria-hidden="true">{checked ? 'Вкл.' : 'Выкл.'}</span>
</label>

<style>
  .settings-toggle {
    position: relative;
    cursor: pointer;
  }

  .settings-toggle--disabled {
    opacity: 0.5;
    cursor: default;
  }

  .settings-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .settings-toggle__status {
    flex-shrink: 0;
    min-width: 3.2rem;
    padding: 0.35rem 0.55rem;
    border-radius: 0.4rem;
    background: var(--uiv2-chrome-bg);
    color: var(--uiv2-fg-muted);
    font-size: 0.8125rem;
    font-weight: 650;
    text-align: center;
  }

  input:checked + .settings-toggle__status {
    background: var(--settings-selected-bg, var(--uiv2-chrome-active-bg));
    color: var(--uikit-v2-accent);
  }
</style>
