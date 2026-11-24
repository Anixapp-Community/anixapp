<script lang="ts">
  /** Сортировка комментариев пилюлей с подписью — как фильтры в закладках/каталоге. */
  import UiV2Button from '../uikit-v2/UiV2Button.svelte';
  import UiV2PopupMenu, { type UiV2PopupMenuItem } from '../uikit-v2/UiV2PopupMenu.svelte';
  import { iconArrowUpDown, iconChevronDown } from '../icons';
  import { COMMENT_SORT_OPTIONS, type CommentSort } from '../../types/comment';

  interface Props {
    sort: CommentSort;
    onSortChange: (sort: CommentSort) => void;
    disabled?: boolean;
  }

  let { sort, onSortChange, disabled = false }: Props = $props();

  let open = $state(false);
  let anchorEl = $state<HTMLElement | null>(null);

  const label = $derived(
    COMMENT_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Сначала новые',
  );

  const items = $derived<UiV2PopupMenuItem[]>(
    COMMENT_SORT_OPTIONS.map((option) => ({
      id: String(option.value),
      label: option.label,
      type: 'radio' as const,
      checked: option.value === sort,
    })),
  );

  function toggle(event: MouseEvent) {
    if (disabled) return;
    anchorEl = event.currentTarget as HTMLElement;
    open = !open;
  }
</script>

<UiV2Button
  size="md"
  variant="chrome"
  {label}
  {disabled}
  class="comments-sort-field"
  ariaHaspopup="menu"
  ariaExpanded={open}
  onclick={toggle}
>
  {#snippet icon()}{@html iconArrowUpDown(16)}{/snippet}
  {#snippet trailing()}{@html iconChevronDown(14)}{/snippet}
</UiV2Button>

<UiV2PopupMenu
  {open}
  x={0}
  y={0}
  dropdown
  anchor={anchorEl}
  {items}
  onClose={() => { open = false; }}
  onSelect={(id) => {
    open = false;
    onSortChange(Number(id) as CommentSort);
  }}
/>
