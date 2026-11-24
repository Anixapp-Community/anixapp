<script lang="ts">
  let {
    label,
    unit,
    value = $bindable(),
    min,
    max,
    onchange,
  }: {
    label: string;
    unit?: string;
    value?: number;
    min: number;
    max: number;
    onchange?: (event: Event) => void;
  } = $props();
</script>

<label class="uiv2-setting-control uiv2-setting-control--number">
  <span class="uiv2-setting-control__label">{label}</span>
  <span class="uiv2-setting-control__value">
    <input type="number" {min} {max} bind:value {onchange} />
    {#if unit}<span class="uiv2-setting-control__unit">{unit}</span>{/if}
  </span>
</label>
