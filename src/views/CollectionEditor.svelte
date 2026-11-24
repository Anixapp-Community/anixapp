<script lang="ts">
  import { onMount } from 'svelte';
  import { iconCheck, iconImage, iconRotateCcw } from '../components/icons';
  import CollectionReleaseList from '../components/collections/CollectionReleaseList.svelte';
  import CollectionReleaseSearch from '../components/collections/CollectionReleaseSearch.svelte';
  import UiV2BackBar from '../components/uikit-v2/UiV2BackBar.svelte';
  import UiV2Button from '../components/uikit-v2/UiV2Button.svelte';
  import UiV2Card from '../components/uikit-v2/UiV2Card.svelte';
  import UiV2OutlinedField from '../components/uikit-v2/UiV2OutlinedField.svelte';
  import UiV2Select from '../components/uikit-v2/UiV2Select.svelte';
  import UiV2SettingsRow from '../components/uikit-v2/UiV2SettingsRow.svelte';
  import UiV2Skeleton from '../components/uikit-v2/UiV2Skeleton.svelte';
  import UiV2Toggle from '../components/uikit-v2/UiV2Toggle.svelte';
  import { navigate } from '../stores/navigation';
  import { showToast } from '../stores/toast';
  import { handleBanCode } from '../stores/ban-alert';
  import { compressImageForUpload } from '../utils/compressImage';
  import {
    COLLECTION_DESCRIPTION_MAX,
    COLLECTION_RELEASES_MAX,
    COLLECTION_RELEASE_SORTS,
    COLLECTION_TITLE_MAX,
    clearCollectionEditorDraft,
    collectionSaveErrorMessage,
    loadCollectionEditorDraft,
    resolveCollectionImage,
    saveCollectionEditorDraft,
    sortCollectionReleases,
    type CollectionReleaseSort,
  } from '../utils/collection';
  import { COLLECTION_RULES_FORBIDDEN, COLLECTION_RULES_FOOTER } from '../utils/collectionRules';
  import { ensureProfileId } from '../utils/profile';
  import UiV2Tooltip from '../components/uikit-v2/UiV2Tooltip.svelte';
  import { releaseRawToStored } from '../utils/release-card';
  import { formatAnixError } from '../native/anix-errors';

  interface Props {
    editId?: number | null;
  }

  let { editId = null }: Props = $props();

  let title = $state('');
  let description = $state('');
  let isPrivate = $state(false);
  let releases = $state<Record<string, unknown>[]>([]);
  let imagePreview = $state<string | null>(null);
  let imageBase64 = $state<string | null>(null);
  let imageFileName = $state<string | null>(null);
  let isSaving = $state(false);
  let isLoading = $state(false);
  let loadError = $state('');
  /** Последняя применённая сортировка; сбрасывается, как только порядок меняют руками. */
  let appliedSort = $state<CollectionReleaseSort | null>(null);
  let orderBeforeSort: Record<string, unknown>[] | null = null;

  let fileInput: HTMLInputElement | undefined = $state();

  const selectedIds = $derived(new Set(releases.map((r) => Number(r.id))));
  const isFull = $derived(releases.length >= COLLECTION_RELEASES_MAX);
  const pageTitle = $derived(editId ? 'Редактирование коллекции' : 'Создание коллекции');
  const canSave = $derived(title.trim().length > 0 && !isSaving && !isLoading);

  function persistDraft() {
    saveCollectionEditorDraft({
      title,
      description,
      isPrivate,
      releaseIds: releases.map((r) => Number(r.id)).filter((id) => Number.isFinite(id)),
      releases,
      imagePreview,
      imageBase64,
      imageFileName,
      editId,
    });
  }

  function applyDraft() {
    const draft = loadCollectionEditorDraft();
    if (!draft) return;
    if (editId && draft.editId !== editId) return;
    if (!editId && draft.editId) return;
    title = draft.title ?? '';
    description = draft.description ?? '';
    isPrivate = !!draft.isPrivate;
    releases = Array.isArray(draft.releases) ? [...draft.releases] : [];
    imagePreview = draft.imagePreview ?? null;
    imageBase64 = draft.imageBase64 ?? null;
    imageFileName = draft.imageFileName ?? null;
  }

  async function loadForEdit(id: number) {
    if (!window.anixApi) return;
    isLoading = true;
    loadError = '';
    try {
      const selfId = await ensureProfileId();
      const infoRes = (await window.anixApi.collection.info(id)) as Record<string, unknown>;
      const info = (infoRes?.collection ?? infoRes) as Record<string, unknown>;
      const creator = (info?.creator ?? {}) as Record<string, unknown>;
      const ownerId = creator.id ?? creator['@id'];
      if (selfId == null || ownerId !== selfId) {
        loadError = 'Нет прав на редактирование этой коллекции';
        return;
      }

      title = String(info.title ?? '');
      description = String(info.description ?? '');
      isPrivate = !!(info.is_private ?? info.isPrivate);
      const imageRaw = info.image as string | undefined;
      if (imageRaw) {
        imagePreview = resolveCollectionImage(info as Record<string, unknown>) || imageRaw;
      }

      const loaded: Record<string, unknown>[] = [];
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const res = (await window.anixApi.collection.getReleases(id, page)) as Record<string, unknown>;
        let content = res?.content ?? res?.releases;
        if (content && !Array.isArray(content) && Array.isArray((content as Record<string, unknown>).releases)) {
          content = (content as Record<string, unknown>).releases;
        }
        const list = (Array.isArray(content) ? content : []) as Record<string, unknown>[];
        loaded.push(...list.filter((item) => item && typeof item.id === 'number'));
        hasMore = list.length >= 25;
        page += 1;
        if (list.length === 0) hasMore = false;
      }
      releases = loaded;
    } catch (err) {
      loadError = String(err);
    } finally {
      isLoading = false;
    }
  }

  async function onImageSelected(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const compressed = await compressImageForUpload(file);
    imageFileName = compressed.name;
    imagePreview = URL.createObjectURL(compressed);
    const reader = new FileReader();
    reader.onload = () => {
      imageBase64 = typeof reader.result === 'string' ? reader.result : null;
      persistDraft();
    };
    reader.readAsDataURL(compressed);
  }

  function setOrder(next: Record<string, unknown>[]) {
    releases = next;
    appliedSort = null;
    orderBeforeSort = null;
  }

  function removeRelease(id: number) {
    setOrder(releases.filter((r) => Number(r.id) !== id));
  }

  function toggleRelease(raw: Record<string, unknown>) {
    const id = Number(raw.id);
    if (selectedIds.has(id)) removeRelease(id);
    else if (!isFull) setOrder([...releases, releaseRawToStored(raw)]);
  }

  function applySort(value: string) {
    const sort = value as CollectionReleaseSort;
    orderBeforeSort ??= releases;
    releases = sortCollectionReleases(releases, sort);
    appliedSort = sort;
  }

  function undoSort() {
    if (orderBeforeSort) setOrder(orderBeforeSort);
  }

  /** Сервер может не вернуть `collection` в ответе create — ищем только что созданную по названию. */
  async function findNewCollectionId(collectionTitle: string): Promise<number | null> {
    try {
      const selfId = await ensureProfileId();
      if (selfId == null) return null;
      const res = (await window.anixApi.collection.profileCollections(selfId, 0)) as Record<string, unknown>;
      const content = Array.isArray(res?.content) ? (res.content as Record<string, unknown>[]) : [];
      const match = content.find((item) => String(item?.title ?? '') === collectionTitle);
      const foundId = Number(match?.id ?? 0);
      return foundId > 0 ? foundId : null;
    } catch {
      return null;
    }
  }

  async function save() {
    if (!window.anixApi?.collectionMy || !canSave) return;
    isSaving = true;
    const body = {
      title: title.trim(),
      description: description.trim(),
      releases: releases.map((r) => Number(r.id)).filter((id) => Number.isFinite(id)),
      is_private: isPrivate,
    };

    let savedId: number | null = null;
    let coverError = '';

    try {
      let res: Record<string, unknown>;
      if (editId) {
        res = (await window.anixApi.collectionMy.edit(editId, body)) as Record<string, unknown>;
      } else {
        res = (await window.anixApi.collectionMy.create(body)) as Record<string, unknown>;
      }

      const code = Number(res?.code ?? 0);
      if (code !== 0) {
        if (handleBanCode(code, 'collections')) return;
        showToast(collectionSaveErrorMessage(code), 'err');
        return;
      }

      const collection = (res?.collection ?? res) as Record<string, unknown>;
      const rawId = Number(collection?.id ?? collection?.['@id'] ?? res?.id ?? res?.collection_id ?? 0);
      savedId = rawId > 0 ? rawId : editId;
      if (!savedId) {
        savedId = await findNewCollectionId(body.title);
      }
      if (!savedId) {
        clearCollectionEditorDraft();
        showToast('Коллекция создана, но сервер не вернул её id — откройте «Мои коллекции»', 'err');
        navigate('/collections/my');
        return;
      }

      if (imageBase64) {
        // Обложка не должна отменять уже сохранённую коллекцию (на Android загрузка может быть недоступна).
        try {
          const imgRes = (await window.anixApi.collectionMy.editImage(
            savedId,
            imageBase64,
            imageFileName ?? 'cover.jpg',
          )) as Record<string, unknown>;
          if (imgRes?.code != null && Number(imgRes.code) !== 0) {
            if (handleBanCode(Number(imgRes.code), 'collections')) return;
            coverError = collectionSaveErrorMessage(Number(imgRes.code));
          }
        } catch (err) {
          coverError = formatAnixError(err);
        }
      }
    } catch (err) {
      showToast(formatAnixError(err), 'err');
      return;
    } finally {
      isSaving = false;
    }

    clearCollectionEditorDraft();
    if (coverError) {
      showToast(`Коллекция сохранена, но обложка не загрузилась: ${coverError}`, 'err');
    } else {
      showToast(editId ? 'Коллекция обновлена' : 'Коллекция создана');
    }
    navigate(`/collection/${savedId}`);
  }

  function goBack() {
    if (editId) navigate(`/collection/${editId}`);
    else navigate('/collections');
  }

  onMount(async () => {
    if (editId) {
      const draft = loadCollectionEditorDraft();
      if (draft?.editId === editId) {
        applyDraft();
        isLoading = false;
        return;
      }
      clearCollectionEditorDraft();
      await loadForEdit(editId);
    } else {
      applyDraft();
    }
  });

  $effect(() => {
    if (isLoading) return;
    title;
    description;
    isPrivate;
    releases;
    imagePreview;
    imageBase64;
    imageFileName;
    persistDraft();
  });
</script>

<div class="view collection-editor">
  <header class="collection-editor__head">
    <UiV2BackBar segments={[{ label: pageTitle, active: true }]} onBack={goBack} />
    <UiV2Button
      label={isSaving ? 'Сохранение…' : 'Сохранить'}
      variant="primary"
      disabled={!canSave}
      onclick={() => void save()}
    >
      {#snippet icon()}{@html iconCheck(16)}{/snippet}
    </UiV2Button>
  </header>

  {#if isLoading}
    <div class="collection-editor__stack" aria-busy="true">
      <UiV2Skeleton tag="div" class="collection-editor__cover-skeleton" rounded="lg" />
      <UiV2Skeleton tag="div" class="collection-editor__rows-skeleton" rounded="lg" />
    </div>
  {:else if loadError}
    <UiV2Card class="collection-editor__error">
      <p>{loadError}</p>
      <UiV2Button label="Назад" onclick={goBack} />
    </UiV2Card>
  {:else}
    <div class="collection-editor__stack">
      <UiV2Card label="Оформление коллекции">
        <div class="collection-editor__cover" class:collection-editor__cover--empty={!imagePreview}>
          {#if imagePreview}
            <img src={imagePreview} alt="" />
          {/if}
          <UiV2Button
            label={imagePreview ? 'Заменить обложку' : 'Загрузить обложку'}
            size="sm"
            onclick={() => fileInput?.click()}
          >
            {#snippet icon()}{@html iconImage(16)}{/snippet}
          </UiV2Button>
          <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onImageSelected} />
        </div>

        <div class="collection-editor__field">
          <UiV2OutlinedField label="Название коллекции" maxlength={COLLECTION_TITLE_MAX} bind:value={title} />
          <span class="collection-editor__counter">{title.length}/{COLLECTION_TITLE_MAX}</span>
        </div>

        <div class="collection-editor__field">
          <UiV2OutlinedField
            label="Описание"
            multiline
            rows={4}
            maxlength={COLLECTION_DESCRIPTION_MAX}
            bind:value={description}
          />
          <span class="collection-editor__counter">{description.length}/{COLLECTION_DESCRIPTION_MAX}</span>
        </div>

        <UiV2SettingsRow title="Доступно только мне">
          <UiV2Toggle label="Доступно только мне" checked={isPrivate} onChange={(next) => (isPrivate = next)} />
        </UiV2SettingsRow>

        <p class="collection-editor__rules">
          Создавая коллекцию, Вы подтверждаете, что ознакомлены с
          <UiV2Tooltip placement="top" interactive={true} showDelay={80} hideDelay={150}>
            <button type="button" class="collection-editor__rules-link">правилами</button>
            {#snippet content()}
              <div class="uiv2-rules-popover">
                <p class="uiv2-rules-popover__title">Правила</p>
                <p class="uiv2-rules-popover__heading">Запрещено:</p>
                <ul class="uiv2-rules-popover__list">
                  {#each COLLECTION_RULES_FORBIDDEN as rule}
                    <li>{rule}</li>
                  {/each}
                </ul>
                <p class="uiv2-rules-popover__footer">{COLLECTION_RULES_FOOTER}</p>
              </div>
            {/snippet}
          </UiV2Tooltip>
        </p>
      </UiV2Card>

      <UiV2Card title="Тайтлы" pill={`${releases.length} из ${COLLECTION_RELEASES_MAX}`}>
        <CollectionReleaseSearch {selectedIds} full={isFull} onToggle={toggleRelease} />

        {#if releases.length > 1}
          <div class="collection-editor__sort">
            <UiV2Select
              class="popular-chip"
              panelClass="popular-chip__panel"
              ariaLabel="Сортировать тайтлы"
              placeholder="Сортировать по"
              options={COLLECTION_RELEASE_SORTS}
              value={appliedSort}
              onChange={applySort}
            />
            {#if appliedSort}
              <UiV2Button label="Вернуть как было" size="sm" variant="ghost" onclick={undoSort}>
                {#snippet icon()}{@html iconRotateCcw(14)}{/snippet}
              </UiV2Button>
            {/if}
          </div>
        {/if}

        {#if releases.length}
          <CollectionReleaseList {releases} onReorder={setOrder} onRemove={removeRelease} />
        {:else}
          <p class="collection-editor__empty">Найдите тайтл через поиск, и он появится здесь</p>
        {/if}
      </UiV2Card>
    </div>
  {/if}
</div>
