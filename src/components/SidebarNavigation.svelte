<script module lang="ts">
  import type { SidebarNavId } from '../constants/sidebar-nav';

  type Side = 'left' | 'right';
  type Entry = { kind: 'item'; id: SidebarNavId } | { kind: 'folder'; id: string };
  export type SidebarDrag = Entry | { kind: 'rail'; side: Side };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createSidebarNavFolder, SIDEBAR_NAV_ITEMS, SIDEBAR_PINS_PLACEMENT_OPTIONS, SIDEBAR_PINS_CONTENT_OPTIONS } from '../constants/sidebar-nav';
  import { getSidebarNavLayout, getSidebarPinsPlacement, getSidebarPinsSource, setSidebarPinsPlacement, setSidebarPinsSource, setSidebarDefaultNavId, setSidebarNavLayout, type SidebarNavLayout } from '../prefs';
  import { addFolderToSide, dissolveFolder, findFolder, insertEntryAt, isSidebarNavLayoutViable, moveFolderToSide, placedIdsOf, putItemInFolder, putItemOnSide, setFolderName, stripNavId } from '../utils/sidebar-nav-layout';
  import { iconFolder, iconGripVertical, iconImage, iconPencil, iconPin, iconPlus, iconX } from './icons';
  import UiV2ChoiceSheet from './uikit-v2/UiV2ChoiceSheet.svelte';
  import UiV2OutlinedField from './uikit-v2/UiV2OutlinedField.svelte';
  import UiV2Button from './uikit-v2/UiV2Button.svelte';
  import UiV2Tooltip from './uikit-v2/UiV2Tooltip.svelte';
  import UiV2PopupMenu, { type UiV2PopupMenuItem } from './uikit-v2/UiV2PopupMenu.svelte';

  let { side, dragging = $bindable(null), children }: {
    side: Side;
    dragging?: SidebarDrag | null;
    children?: Snippet;
  } = $props();

  const dragType = 'application/x-anix-navigation';
  const opposite = $derived(side === 'left' ? 'right' : 'left');
  let over = $state<HTMLElement>();
  let overPanel = $state(false);
  let dragSource: HTMLElement | undefined;
  let hintOffset = $state(0);
  const dropHint = $derived.by(() => {
    if (!overPanel || !dragging) return '';
    if (dragging.kind === 'rail') return dragging.side === side ? '' : 'Перенести панель сюда';
    if (position === 'inside') return over?.dataset.navFolderHandle ? 'Добавить в папку' : 'Создать папку';
    if (position === 'before' || position === 'after') return 'Вставить ' + (position === 'before' ? 'выше' : 'ниже');
    return !over ? 'Переместить сюда' : '';
  });
  let position = $state<'before' | 'after' | 'inside'>();
  let renameFolder = $state<{ id: string; name: string }>();
  let menu = $state<{ x: number; y: number; target?: Entry; items: UiV2PopupMenuItem[] }>();

  function isSidebarNavId(value: string | undefined): value is SidebarNavId {
    return SIDEBAR_NAV_ITEMS.some((item) => item.id === value);
  }

  function entryOf(element?: HTMLElement | null): Entry | undefined {
    const item = element?.dataset.navItem;
    if (isSidebarNavId(item)) return { kind: 'item', id: item };
    const folder = element?.dataset.navFolderHandle;
    if (folder) return { kind: 'folder', id: folder };
  }

  function targetOf(event: MouseEvent) {
    return (event.target as Element).closest<HTMLElement>('[data-nav-item], [data-nav-folder-handle]');
  }

  function persist(layout: SidebarNavLayout) {
    if (isSidebarNavLayoutViable(layout)) setSidebarNavLayout(layout);
  }

  function moveRail(layout: SidebarNavLayout, from: Side, to: Side) {
    if (from === to || !layout[from].length) return;
    persist({ ...layout, [from]: [], [to]: [...layout[to], ...layout[from]] });
  }

  function showMenu(event: MouseEvent) {
    const element = targetOf(event);
    const target = entryOf(element);
    const keyboardOrGrip = event.type === 'click';
    if (!target && !keyboardOrGrip && (event.target as Element).closest('button:not([data-nav-grip]), a')) return;
    event.preventDefault();

    const layout = getSidebarNavLayout();
    const placed = placedIdsOf(layout);
    const available = SIDEBAR_NAV_ITEMS.filter((item) => !placed.has(item.id));
    const items: UiV2PopupMenuItem[] = [];
    if (target?.kind === 'item') {
      items.push({ id: 'default', label: 'Открывать при запуске', icon: iconPin(16) });
      items.push({ id: 'remove', label: 'Убрать вкладку', icon: iconX(16), danger: true,
        disabled: !isSidebarNavLayoutViable(stripNavId(layout, target.id)) });
    } else if (target?.kind === 'folder') {
      items.push({ id: 'rename', label: 'Переименовать папку', icon: iconPencil(16) });
      items.push({ id: 'dissolve', label: 'Расформировать папку', icon: iconX(16),
        disabled: !isSidebarNavLayoutViable(dissolveFolder(layout, target.id)) });
    }
    if (available.length) {
      items.push({ id: 'add', label: 'Добавить вкладку', icon: iconPlus(16), dividerBefore: items.length > 0,
        children: available.map((item) => ({ id: 'add:' + item.id, label: item.label, icon: item.icon })) });
    }
    items.push({ id: 'folder', label: 'Создать папку', icon: iconFolder(16) });
    if (layout[side].length) {
      items.push({ id: 'move', label: side === 'left' ? 'Перенести панель вправо' : 'Перенести панель влево' });
    }
    const placement = getSidebarPinsPlacement();
    const source = getSidebarPinsSource();
    items.push({
      id: 'thumbnails', label: 'Быстрый доступ', icon: iconImage(16), dividerBefore: true,
      children: [
        { id: 'thumbnails-placement', label: 'Расположение', children: SIDEBAR_PINS_PLACEMENT_OPTIONS.map((option) => ({
          id: 'pins-placement:' + option.id, label: option.label, type: 'radio', checked: option.id === placement,
        })) },
        { id: 'thumbnails-source', label: 'Источник', children: SIDEBAR_PINS_CONTENT_OPTIONS.map((option) => ({
          id: 'pins-source:' + option.id, label: option.label, type: 'radio', checked: option.id === source,
        })) },
      ],
    });
    const rect = (event.target as Element).getBoundingClientRect();
    menu = { x: keyboardOrGrip ? rect.right : event.clientX, y: keyboardOrGrip ? rect.bottom : event.clientY, target, items };
  }

  function select(id: string) {
    const target = menu?.target;
    const layout = getSidebarNavLayout();
    const itemId = id.startsWith('add:') ? id.slice(4) : undefined;
    const placement = SIDEBAR_PINS_PLACEMENT_OPTIONS.find((option) => id === 'pins-placement:' + option.id);
    const source = SIDEBAR_PINS_CONTENT_OPTIONS.find((option) => id === 'pins-source:' + option.id);
    if (placement) {
      setSidebarPinsPlacement(placement.id);
    } else if (source) {
      setSidebarPinsSource(source.id);
    } else if (isSidebarNavId(itemId)) {
      persist(target?.kind === 'folder'
        ? putItemInFolder(layout, target.id, itemId)
        : putItemOnSide(layout, side, itemId));
    } else if (id === 'folder') {
      persist(addFolderToSide(layout, side));
    } else if (id === 'move') {
      moveRail(layout, side, opposite);
    } else if (id === 'default' && target?.kind === 'item') {
      setSidebarDefaultNavId(target.id);
    } else if (id === 'remove' && target?.kind === 'item') {
      persist(stripNavId(layout, target.id));
    } else if (id === 'rename' && target?.kind === 'folder') {
      const folder = findFolder(layout, target.id);
      if (folder) renameFolder = { id: folder.id, name: folder.name };
    } else if (id === 'dissolve' && target?.kind === 'folder') {
      persist(dissolveFolder(layout, target.id));
    }
    menu = undefined;
  }

  function saveFolderName() {
    if (!renameFolder?.name.trim()) return;
    persist(setFolderName(getSidebarNavLayout(), renameFolder.id, renameFolder.name));
    renameFolder = undefined;
  }

  function startDrag(event: DragEvent) {
    const target = event.target as Element;
    const drag: SidebarDrag | undefined = target.closest('[data-nav-grip]')
      ? { kind: 'rail', side }
      : entryOf(targetOf(event));
    if (!drag || !event.dataTransfer) return;
    event.dataTransfer.setData(dragType, '1');
    event.dataTransfer.effectAllowed = 'move';
    menu = undefined;
    dragging = drag;
    dragSource = target.closest<HTMLElement>('[data-nav-grip], [data-nav-item], [data-nav-folder-handle]') ?? undefined;
    requestAnimationFrame(() => { dragSource?.setAttribute('data-nav-drag-source', ''); });
  }

  function clearHover() {
    overPanel = false;
    over = undefined;
    position = undefined;
  }

  function endDrag() {
    dragging = null;
    dragSource?.removeAttribute('data-nav-drag-source');
    dragSource = undefined;
    clearHover();
  }

  function dropPosition(event: DragEvent, element: HTMLElement | null) {
    const target = entryOf(element);
    if (!element || !target || !dragging || dragging.kind === 'rail') return;
    if (target.kind === dragging.kind && target.id === dragging.id) return;
    const bounds = element.getBoundingClientRect();
    const relativeY = (event.clientY - bounds.top) / bounds.height;
    const inFolder = target.kind === 'item' && Boolean(element.closest('[data-nav-folder]'));
    if (dragging.kind === 'folder' || inFolder) return relativeY < 0.5 ? 'before' : 'after';
    if (relativeY < 0.22) return 'before';
    if (relativeY > 0.78) return 'after';
    return 'inside';
  }

  function dragOver(event: DragEvent) {
    if (!dragging || !event.dataTransfer?.types.includes(dragType)) return;
    if (dragging.kind === 'rail' && dragging.side === side) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const element = dragging.kind === 'rail' ? null : targetOf(event);
    const rail = (event.currentTarget as HTMLElement).getBoundingClientRect();
    overPanel = true;
    over = element ?? undefined;
    position = dropPosition(event, element);
    hintOffset = Math.max(0, Math.min(event.clientY - rail.top - 14, rail.height - 28));
  }

  function drop(event: DragEvent) {
    if (!dragging || !event.dataTransfer?.types.includes(dragType)) return;
    event.preventDefault();
    const drag = dragging;
    const element = targetOf(event);
    const target = entryOf(element);
    const zone = dropPosition(event, element);
    endDrag();

    const layout = getSidebarNavLayout();
    if (drag.kind === 'rail') {
      moveRail(layout, drag.side, side);
      return;
    }
    if (target?.kind === drag.kind && target.id === drag.id) return;

    const folderId = element?.closest<HTMLElement>('[data-nav-folder]')?.dataset.navFolder;
    const targetIndex = layout[side].findIndex((entry) => entry.kind === 'folder'
      ? entry.folder.id === folderId
      : target?.kind === 'item' && entry.id === target.id);
    const index = targetIndex < 0 ? null : targetIndex + (zone === 'before' ? 0 : 1);

    if (drag.kind === 'folder') {
      persist(moveFolderToSide(layout, drag.id, side, index));
    } else if (target?.kind === 'folder' && zone === 'inside') {
      persist(putItemInFolder(layout, target.id, drag.id));
    } else if (target?.kind === 'item' && folderId) {
      const folder = findFolder(layout, folderId);
      const childIndex = folder?.children.indexOf(target.id) ?? -1;
      if (childIndex >= 0) persist(putItemInFolder(layout, folderId, drag.id, childIndex + (zone === 'before' ? 0 : 1)));
    } else if (target?.kind === 'item' && zone === 'inside') {
      const next = stripNavId(layout, drag.id);
      const at = next[side].findIndex((entry) => entry.kind === 'item' && entry.id === target.id);
      if (at < 0) return;
      next[side].splice(at, 1);
      next[side] = insertEntryAt(next[side], {
        kind: 'folder',
        folder: createSidebarNavFolder({ children: [target.id, drag.id] }),
      }, at);
      persist(next);
    } else {
      persist(putItemOnSide(layout, side, drag.id, index));
    }
  }

  $effect(() => {
    if (!dragging) clearHover();
  });

  $effect(() => {
    if (!over || !position) return;
    const element = over;
    element.dataset.navDrop = position;
    return () => { delete element.dataset.navDrop; };
  });
</script>

<svelte:window ondragend={endDrag} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside class="sidebar sidebar--editable" class:sidebar--nav-dragging={!!dragging}
  class:sidebar--nav-drop-side={overPanel && !over}
  class:sidebar--rail-target={dragging?.kind === 'rail' && dragging.side !== side}
  aria-label={side === 'left' ? 'Левая панель' : 'Правая панель'}
  oncontextmenu={showMenu}
  ondragstart={startDrag}
  ondragover={dragOver}
  ondragleave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearHover();
  }}
  ondrop={drop}
>
  <UiV2Tooltip
    text="Меню навигации · перетащите панель влево или вправо"
    placement={side === 'left' ? 'right' : 'left'}
    disabled={!!dragging || !!menu}
  >
    <button type="button" class="sidebar__nav-grip" data-nav-grip draggable="true" aria-haspopup="menu"
      aria-label="Меню навигации" onclick={showMenu}
    >{@html iconGripVertical(14)}</button>
  </UiV2Tooltip>
  {@render children?.()}
  {#if dropHint}
    <span class="sidebar__drop-hint" class:sidebar__drop-hint--right={side === 'right'}
      style:top={hintOffset + 'px'} aria-hidden="true">{dropHint}</span>
  {/if}
</aside>

<UiV2PopupMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0}
  items={menu?.items ?? []} onSelect={select} onCheckedChange={select} onClose={() => { menu = undefined; }}
/>

{#if renameFolder}
  <UiV2ChoiceSheet title="Переименовать папку" onClose={() => { renameFolder = undefined; }}>
    {#snippet content()}
      <form onsubmit={(event) => { event.preventDefault(); saveFolderName(); }}>
        <UiV2OutlinedField label="Название папки" bind:value={renameFolder.name} maxlength={32} required />
      </form>
    {/snippet}
    {#snippet footer()}
      <UiV2Button label="Сохранить" variant="primary" size="lg" block
        disabled={!renameFolder.name.trim()} onclick={saveFolderName}
      />
    {/snippet}
  </UiV2ChoiceSheet>
{/if}
