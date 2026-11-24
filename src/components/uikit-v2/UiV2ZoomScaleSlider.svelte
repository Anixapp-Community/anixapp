<script lang="ts">
  import UiV2SettingsSlider from './UiV2SettingsSlider.svelte';
  import { DEFAULT_ZOOM, ZOOM_LEVELS, normalizeZoom, type ZoomLevel } from '../../utils/zoom';

  let {
    value,
    label = 'Масштаб интерфейса',
    onChange,
  }: {
    value: number;
    label?: string;
    onChange: (value: ZoomLevel) => void;
  } = $props();

  const current = $derived(normalizeZoom(value));
</script>

<UiV2SettingsSlider
  {label}
  value={ZOOM_LEVELS.indexOf(current)}
  valueText="{current}%"
  max={ZOOM_LEVELS.length - 1}
  defaultValue={ZOOM_LEVELS.indexOf(DEFAULT_ZOOM)}
  defaultText="{DEFAULT_ZOOM}%"
  onChange={(index) => onChange(ZOOM_LEVELS[index])}
/>
