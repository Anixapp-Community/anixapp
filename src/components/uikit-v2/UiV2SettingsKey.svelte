<script lang="ts">
  let {
    label,
    description,
    value,
    capturing = false,
    onclick,
    onkeydown,
    onblur,
  }: {
    label: string;
    description?: string;
    value: string;
    capturing?: boolean;
    onclick: () => void;
    onkeydown?: (event: KeyboardEvent) => void;
    onblur?: () => void;
  } = $props();

  const keys = $derived(value.split(/\s+\+\s+/));
</script>

<button
  type="button"
  class="uiv2-setting-control uiv2-setting-control--key"
  class:uiv2-setting-control--active={capturing}
  {onclick}
  {onkeydown}
  {onblur}
>
  <span class="uiv2-setting-control__label">
    {label}
    {#if description}<span class="uiv2-setting-control__description">{description}</span>{/if}
  </span>
  {#if capturing}
    <span class="uiv2-setting-control__value" aria-live="polite">Нажмите клавишу…</span>
  {:else}
    <span class="uiv2-setting-control__value uiv2-setting-control__keys">
      {#each keys as key, index (`${index}:${key}`)}
        {#if index > 0}<span class="uiv2-setting-control__unit">+</span>{/if}
        <kbd>{key}</kbd>
      {/each}
    </span>
  {/if}
</button>
