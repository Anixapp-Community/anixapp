<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { portal } from '../actions/portal';
  import UiV2Button from './uikit-v2/UiV2Button.svelte';
  import UiV2ScrollArea from './uikit-v2/UiV2ScrollArea.svelte';
  import { iconBan, iconCheck, iconClock, iconShare, iconTrash2, iconEyeOff, iconUser } from './icons';
  import {
    PROFILE_HEALTH_INFO_HTML,
    COMMENT_RULES_URL,
    normalizeHealthStatus,
    normalizeEnforcementList,
    normalizeEnforcement,
    healthTone,
    healthStatusTitle,
    healthStatusNote,
    blogSuspensionRow,
    blogMuteRow,
    lastBanTile,
    enforcementEmptyText,
    enforcementStateLabel,
    enforcementListTitle,
    enforcementListHint,
    enforcementTimeLabel,
    enforcementDetailTitle,
    enforcementDetailBody,
    enforcementTargetPath,
    enforcementGoTargetLabel,
    isAdjustmentRequired,
    formatEnforcementContentHtml,
    type HealthTab,
    type ProfileHealthStatus,
    type ProfileEnforcementItem,
  } from '../utils/profile-health';
  import { requestOpenExternal } from '../utils/external-link';
  import { navigate } from '../stores/navigation';
  import { closeProfilePanel } from '../stores/profile-panel';

  type Props = {
    avatarUrl?: string;
  };

  let { avatarUrl = '' }: Props = $props();

  let loadState = $state<'loading' | 'ready' | 'error'>('loading');
  let status = $state<ProfileHealthStatus | null>(null);
  let tab = $state<HealthTab>('account');
  let accountItems = $state<ProfileEnforcementItem[]>([]);
  let contentItems = $state<ProfileEnforcementItem[]>([]);
  let accountState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let contentState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let accountPage = $state(0);
  let contentPage = $state(0);
  let accountHasMore = $state(false);
  let contentHasMore = $state(false);
  let moreBusy = $state(false);
  let infoOpen = $state(false);
  let detailOpen = $state(false);
  let detailLoading = $state(false);
  let detailItem = $state<ProfileEnforcementItem | null>(null);

  const tone = $derived(status ? healthTone(status) : 'green');
  const title = $derived(status ? healthStatusTitle(status) : '…');
  const note = $derived(status ? healthStatusNote(status) : '');
  const suspension = $derived(status ? blogSuspensionRow(status) : null);
  const mute = $derived(status ? blogMuteRow(status) : null);
  const lastBan = $derived(status ? lastBanTile(status) : null);
  const items = $derived(tab === 'account' ? accountItems : contentItems);
  const listState = $derived(tab === 'account' ? accountState : contentState);
  const hasMore = $derived(tab === 'account' ? accountHasMore : contentHasMore);
  const empty = $derived(enforcementEmptyText(tab));

  async function loadStatus() {
    if (!window.anixApi?.profileHealth?.status) {
      loadState = 'error';
      return;
    }
    loadState = 'loading';
    try {
      const res = (await window.anixApi.profileHealth.status()) as Record<string, unknown>;
      const code = Number(res?.code ?? 0);
      if (res && 'code' in res && code !== 0) {
        status = null;
        loadState = 'error';
        return;
      }
      status = normalizeHealthStatus(res);
      loadState = 'ready';
    } catch {
      loadState = 'error';
    }
  }

  async function loadList(kind: HealthTab, append = false) {
    const api = window.anixApi?.profileHealth;
    if (!api) {
      if (kind === 'account') accountState = 'error';
      else contentState = 'error';
      return;
    }
    const page = append ? (kind === 'account' ? accountPage : contentPage) : 0;
    if (!append) {
      if (kind === 'account') accountState = 'loading';
      else contentState = 'loading';
    }
    try {
      const data = kind === 'account' ? await api.account(page) : await api.content(page);
      const list = normalizeEnforcementList(data);
      if (kind === 'account') {
        accountItems = append ? [...accountItems, ...list] : list;
        accountPage = page + 1;
        accountHasMore = list.length >= 20;
        accountState = 'ready';
      } else {
        contentItems = append ? [...contentItems, ...list] : list;
        contentPage = page + 1;
        contentHasMore = list.length >= 20;
        contentState = 'ready';
      }
    } catch {
      if (append) return;
      if (kind === 'account') {
        accountItems = [];
        accountState = 'error';
      } else {
        contentItems = [];
        contentState = 'error';
      }
    }
  }

  async function loadMore() {
    if (moreBusy || !hasMore) return;
    moreBusy = true;
    await loadList(tab, true);
    moreBusy = false;
  }

  function setTab(next: HealthTab) {
    tab = next;
    const state = next === 'account' ? accountState : contentState;
    if (state === 'idle' || state === 'error') void loadList(next);
  }

  async function openDetails(item: ProfileEnforcementItem) {
    detailItem = item;
    detailOpen = true;
    detailLoading = true;
    try {
      const res = await window.anixApi?.profileHealth?.enforcement?.(item.id);
      const raw = (res?.enforcement ?? null) as Record<string, unknown> | null;
      if (raw) detailItem = normalizeEnforcement(raw);
    } catch {
      /* keep list item */
    } finally {
      detailLoading = false;
    }
  }

  function closeDetails() {
    detailOpen = false;
    detailItem = null;
  }

  function goToEnforcementTarget(item: ProfileEnforcementItem) {
    const path = enforcementTargetPath(item);
    if (!path) return;
    closeDetails();
    closeProfilePanel();
    navigate(path);
  }

  function openRules(e: MouseEvent) {
    e.preventDefault();
    requestOpenExternal(COMMENT_RULES_URL);
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (detailOpen) {
      e.preventDefault();
      closeDetails();
      return;
    }
    if (infoOpen) {
      e.preventDefault();
      infoOpen = false;
    }
  }

  function stateIcon(item: ProfileEnforcementItem): string {
    if (item.type === 'profile_ban') return iconBan(18);
    if (item.type === 'channel_mute') return iconEyeOff(18);
    if (item.type === 'channel_suspension') return iconShare(18);
    if (isAdjustmentRequired(item)) return iconClock(18);
    return iconTrash2(18);
  }

  onMount(() => {
    void loadStatus();
    void loadList('account');
    void loadList('content');
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="pp-health">
  {#if loadState === 'loading'}
    <p class="pp-health__hint">Загрузка…</p>
  {:else if loadState === 'error' || !status}
    <p class="pp-health__hint pp-health__hint--err">Не удалось загрузить статус аккаунта</p>
  {:else}
    <section class="pp-health__card" aria-label="Состояние аккаунта">
      <button
        type="button"
        class="pp-health__help"
        aria-label="Как это работает"
        title="Как это работает"
        onclick={() => (infoOpen = true)}
      >
        <span class="pp-health__help-mark" aria-hidden="true">?</span>
      </button>

      <div
        class="pp-health__avatar"
        class:pp-health__avatar--empty={!avatarUrl}
        style={avatarUrl ? `background-image:url('${avatarUrl}')` : undefined}
        aria-hidden="true"
      >{#if !avatarUrl}{@html iconUser(34)}{/if}</div>

      <div class="pp-health__status">
        <h2 class="pp-health__title">{title}</h2>
        <span class="pp-health__status-icon pp-health__status-icon--{tone}" aria-hidden="true">
          {#if tone === 'green'}{@html iconCheck(14)}{:else}!{/if}
        </span>
      </div>
      <p class="pp-health__note">{note}</p>

      <div class="pp-health__tiles">
        <div class="pp-health__tile">
          <span class="pp-health__tile-value">{status.banCount}</span>
          <span class="pp-health__tile-label">Всего банов</span>
        </div>
        <div class="pp-health__tile">
          <span class="pp-health__tile-value">{status.banFor3MonthCount}</span>
          <span class="pp-health__tile-label">За 3 месяца</span>
        </div>
        {#if lastBan}
          <div class="pp-health__tile">
            <span class="pp-health__tile-value pp-health__tile-value--date">{lastBan}</span>
            <span class="pp-health__tile-label">Последний бан</span>
          </div>
        {/if}
      </div>

      {#if suspension}
        <div class="pp-health__restriction">
          <span class="pp-health__restriction-icon" aria-hidden="true">{@html iconShare(16)}</span>
          <span class="pp-health__restriction-body">
            <span class="pp-health__restriction-title">{suspension.title}</span>
            <span class="pp-health__restriction-until">{suspension.until}</span>
          </span>
        </div>
      {/if}

      {#if mute}
        <div class="pp-health__restriction">
          <span class="pp-health__restriction-icon" aria-hidden="true">{@html iconEyeOff(16)}</span>
          <span class="pp-health__restriction-body">
            <span class="pp-health__restriction-title">{mute.title}</span>
            <span class="pp-health__restriction-until">{mute.until}</span>
          </span>
        </div>
      {/if}
    </section>
  {/if}

  <section class="pp-health__history" aria-label="История модерации">
    <h3 class="pp-health__section">История модерации</h3>

    <div class="pp-health__tabs" role="tablist" aria-label="История модерации">
      <button
        type="button"
        role="tab"
        class="pp-health__tab"
        class:pp-health__tab--on={tab === 'account'}
        aria-selected={tab === 'account'}
        onclick={() => setTab('account')}
      >
        Аккаунт
      </button>
      <button
        type="button"
        role="tab"
        class="pp-health__tab"
        class:pp-health__tab--on={tab === 'content'}
        aria-selected={tab === 'content'}
        onclick={() => setTab('content')}
      >
        Контент
      </button>
    </div>

    <div class="pp-health__list" role="tabpanel">
      {#if listState === 'loading' || listState === 'idle'}
        <p class="pp-health__hint">Загрузка…</p>
      {:else if listState === 'error'}
        <p class="pp-health__hint pp-health__hint--err">Не удалось загрузить список</p>
        <div class="pp-health__retry">
          <UiV2Button
            label="Повторить"
            size="md"
            variant="chrome"
            onclick={() => void loadList(tab)}
          />
        </div>
      {:else if items.length === 0}
        <div class="pp-health__empty-card">
          <p class="pp-health__empty-title">{empty.title}</p>
          <p class="pp-health__empty-summary">{empty.summary}</p>
        </div>
      {:else}
        <ul class="pp-health__items">
          {#each items as item, index (item.id)}
            {@const needsAction = isAdjustmentRequired(item)}
            {@const label = enforcementStateLabel(item)}
            {@const hint = enforcementListHint(item)}
            {@const time = enforcementTimeLabel(item)}
            <li class="pp-health__item" class:pp-health__item--last={index === items.length - 1}>
              <button
                type="button"
                class="pp-health__row"
                onclick={() => void openDetails(item)}
              >
                <span class="pp-health__node" class:pp-health__node--action={needsAction} aria-hidden="true">
                  {@html stateIcon(item)}
                </span>
                <span class="pp-health__item-body">
                  <span class="pp-health__item-message">{enforcementListTitle(item)}</span>
                  <span class="pp-health__item-meta">
                    {#if time}<span class="pp-health__item-date">{time}</span>{/if}
                    {#if label}
                      <span
                        class="pp-health__state"
                        class:pp-health__state--revoked={item.isRevoked}
                      >{label}</span>
                    {/if}
                  </span>
                  {#if hint}
                    <span class="pp-health__reason">
                      <span class="pp-health__reason-label">Причина:</span>
                      {hint}
                    </span>
                  {/if}
                  {#if needsAction}
                    <span class="pp-health__appeal">Принять действие</span>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if hasMore}
          <div class="pp-health__retry">
            <UiV2Button
              label={moreBusy ? 'Загрузка…' : 'Показать ещё'}
              size="md"
              variant="chrome"
              disabled={moreBusy}
              onclick={() => void loadMore()}
            />
          </div>
        {/if}
      {/if}
    </div>
  </section>
</div>

{#if infoOpen}
  <div class="pp-health-sheet" role="dialog" aria-modal="true" aria-labelledby="pp-health-info-title" use:portal>
    <button
      type="button"
      class="pp-health-sheet__backdrop"
      aria-label="Закрыть"
      onclick={() => (infoOpen = false)}
      transition:fade={{ duration: 160 }}
    ></button>
    <div
      class="pp-health-sheet__panel"
      transition:scale={{ duration: 220, start: 0.94, easing: cubicOut }}
    >
      <h3 id="pp-health-info-title" class="pp-health-sheet__title">Как это работает</h3>
      <UiV2ScrollArea class="pp-health-sheet__scroll" padding="0 0.2rem 0 0">
        <div class="pp-health-sheet__body">
          {@html PROFILE_HEALTH_INFO_HTML}
        </div>
      </UiV2ScrollArea>
      <UiV2Button
        label="Понятно"
        size="lg"
        block
        variant="chrome"
        onclick={() => (infoOpen = false)}
      />
    </div>
  </div>
{/if}

{#if detailOpen && detailItem}
  {@const detail = enforcementDetailBody(detailItem)}
  {@const needsAction = isAdjustmentRequired(detailItem)}
  {@const goLabel = enforcementGoTargetLabel(detailItem)}
  {@const canGo = !!enforcementTargetPath(detailItem)}
  <div class="pp-health-sheet" role="dialog" aria-modal="true" aria-labelledby="pp-health-detail-title" use:portal>
    <button
      type="button"
      class="pp-health-sheet__backdrop"
      aria-label="Закрыть"
      onclick={closeDetails}
      transition:fade={{ duration: 160 }}
    ></button>
    <div
      class="pp-health-sheet__panel"
      transition:scale={{ duration: 220, start: 0.94, easing: cubicOut }}
    >
      <h3 id="pp-health-detail-title" class="pp-health-sheet__title">
        {enforcementDetailTitle(detailItem)}
      </h3>
      <UiV2ScrollArea class="pp-health-sheet__scroll" padding="0 0.2rem 0 0">
        <div class="pp-health-sheet__body">
          {#if detailLoading}
          <p>Загрузка…</p>
        {:else}
          <p class="pp-health-sheet__lead">{detail.lead}</p>
          {#if detail.sections.length}
            <div class="pp-health-sheet__sections">
              {#each detail.sections as section}
                <div class="pp-health-sheet__section">
                  <span class="pp-health-sheet__section-label">{section.label}</span>
                  <div class="pp-health-sheet__section-value">
                    {@html formatEnforcementContentHtml(section.value)}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          <p class="pp-health-sheet__tip">
            Рекомендуем повторно ознакомиться с
            <a href={COMMENT_RULES_URL} onclick={openRules}>правилами сообщества</a>.
          </p>
        {/if}
        </div>
      </UiV2ScrollArea>
      {#if needsAction}
        <div class="pp-health-sheet__actions">
          <UiV2Button
            label="Закрыть"
            size="lg"
            variant="chrome"
            onclick={closeDetails}
          />
          <UiV2Button
            label={goLabel}
            size="lg"
            variant="light"
            disabled={!canGo || detailLoading}
            onclick={() => goToEnforcementTarget(detailItem!)}
          />
        </div>
      {:else}
        <UiV2Button
          label="Закрыть"
          size="lg"
          block
          variant="chrome"
          onclick={closeDetails}
        />
      {/if}
    </div>
  </div>
{/if}

<style>
  .pp-health {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.5rem 1.1rem 1.5rem;
    font-family: var(--uikit-v2-font, inherit);
    color: var(--uikit-v2-text, #fff);
  }

  .pp-health__hint {
    margin: 1rem 0;
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
    font-size: 0.9rem;
    text-align: center;
  }

  .pp-health__hint--err {
    color: var(--uikit-v2-danger, #e57373);
  }

  .pp-health__retry {
    display: flex;
    justify-content: center;
  }

  /* ── Карточка состояния ───────────────────────────────────────── */

  .pp-health__card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.25rem 1rem 1.1rem;
    border-radius: 1.75rem;
    background: var(--pp-surface, #1b1b1d);
    text-align: center;
  }

  .pp-health__help {
    position: absolute;
    top: 1rem;
    right: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--pp-fg-soft, var(--uiv2-fg-soft));
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pp-health__help:hover {
    background: var(--uiv2-hover-bg, rgba(255, 255, 255, 0.08));
  }

  .pp-health__help:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--uikit-v2-accent, #8b7bd8) 60%, transparent);
    outline-offset: 2px;
  }

  .pp-health__help-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1;
  }

  .pp-health__avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 6rem;
    height: 6rem;
    border-radius: 50%;
    background: #232326 center / cover no-repeat;
    color: color-mix(in srgb, var(--uiv2-fg-soft, #fff) 40%, transparent);
  }

  .pp-health__avatar--empty {
    background: rgba(255, 255, 255, 0.06);
  }

  .pp-health__status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    margin-top: 1.35rem;
  }

  .pp-health__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    border-radius: 50%;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1;
    color: #fff;
  }

  .pp-health__status-icon--red {
    background: #f25c5c;
  }

  .pp-health__status-icon--orange {
    background: #e8a45c;
  }

  .pp-health__status-icon--green {
    background: #5fbf72;
  }

  .pp-health__note {
    margin: 0.4rem 0 0;
    max-width: 22rem;
    font-size: 0.95rem;
    line-height: 1.35;
    color: var(--pp-fg-soft, var(--uiv2-fg-soft));
  }

  .pp-health__tiles {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    width: 100%;
    margin-top: 1.35rem;
  }

  .pp-health__tile {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    min-width: 0;
    padding: 0.85rem 0.35rem 0.8rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.06);
  }

  .pp-health__tile-value {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.1;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__tile-value--date {
    font-size: 1.3rem;
    white-space: nowrap;
  }

  .pp-health__tile-label {
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
    text-align: center;
  }

  .pp-health__restriction {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    margin-top: 0.6rem;
    padding: 0.65rem 0.8rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.045);
    text-align: left;
  }

  .pp-health__restriction-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    color: var(--pp-fg-soft, var(--uiv2-fg-soft));
    flex-shrink: 0;
  }

  .pp-health__restriction-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pp-health__restriction-title {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__restriction-until {
    font-size: 0.78rem;
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
  }

  /* ── История модерации ────────────────────────────────────────── */

  .pp-health__history {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem 0.9rem 0.6rem;
    border-radius: 1.75rem;
    background: var(--pp-surface, #1b1b1d);
  }

  .pp-health__section {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__tabs {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: start;
    gap: 0.25rem;
    padding: 0.3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
  }

  .pp-health__tab {
    min-height: 2.5rem;
    padding: 0.4rem 1.15rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
    font: inherit;
    font-size: 0.92rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .pp-health__tab--on {
    background: color-mix(in srgb, #fff 16%, #2b2b30);
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__tab:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--uikit-v2-accent, #8b7bd8) 60%, transparent);
    outline-offset: 2px;
  }

  .pp-health__items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .pp-health__item {
    position: relative;
  }

  .pp-health__item::before {
    content: '';
    position: absolute;
    top: 2.95rem;
    bottom: -0.3rem;
    left: 1.66rem;
    width: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--uiv2-fg-soft, #fff) 10%, transparent);
  }

  .pp-health__item--last::before {
    display: none;
  }

  .pp-health__row {
    display: flex;
    gap: 0.8rem;
    width: 100%;
    padding: 0.55rem 0.6rem;
    border: 0;
    border-radius: 0.9rem;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .pp-health__row:hover {
    background: var(--uiv2-hover-bg, rgba(255, 255, 255, 0.05));
  }

  .pp-health__row:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--uikit-v2-accent, #8b7bd8) 55%, transparent);
    outline-offset: 2px;
  }

  .pp-health__node {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    margin-top: 0.1rem;
    border-radius: 50%;
    background: #f25c5c;
    color: #fff;
  }

  .pp-health__node--action {
    background: #3bb6a8;
  }

  .pp-health__item-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-width: 0;
  }

  .pp-health__item-message {
    font-size: 0.98rem;
    font-weight: 700;
    line-height: 1.3;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__item-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .pp-health__item-date {
    font-size: 0.85rem;
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
  }

  .pp-health__state {
    padding: 1px 0.5rem;
    border-radius: 0.35rem;
    background: color-mix(in srgb, #f25c5c 24%, transparent);
    color: #ff9c9c;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .pp-health__state--revoked {
    background: color-mix(in srgb, var(--uiv2-fg-soft, #fff) 12%, transparent);
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
  }

  .pp-health__reason {
    display: block;
    width: 100%;
    margin-top: 0.45rem;
    padding: 0.6rem 0.8rem;
    border-radius: 0.85rem;
    background: rgba(255, 255, 255, 0.045);
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__reason-label {
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
  }

  .pp-health__appeal {
    margin-top: 0.5rem;
    padding: 0.35rem 0.85rem;
    border-radius: 0.6rem;
    background: color-mix(in srgb, var(--uikit-v2-accent, #8b7bd8) 20%, transparent);
    font-size: 0.8rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--uikit-v2-accent, #8b7bd8) 60%, #fff);
  }

  .pp-health__empty-card {
    padding: 1.5rem 1rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.045);
    text-align: center;
  }

  .pp-health__empty-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--uiv2-fg-strong, #fff);
  }

  .pp-health__empty-summary {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--pp-fg-muted, var(--uiv2-fg-muted));
  }

  /* ── Диалоги ──────────────────────────────────────────────────── */

  .pp-health-sheet__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem;
    margin-top: 0.25rem;
  }

  .pp-health-sheet {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    padding: 1.25rem;
  }

  .pp-health-sheet__backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: var(--uiv2-overlay, rgba(0, 0, 0, 0.62));
    cursor: pointer;
  }

  .pp-health-sheet__panel {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: min(26rem, 100%);
    max-height: min(80vh, 40rem);
    overflow: hidden;
    padding: 1.15rem;
    border-radius: 1rem;
    border: 1px solid var(--uiv2-panel-border, rgba(255, 255, 255, 0.08));
    background: var(--uiv2-panel-bg, #1c1c1e);
    color: var(--uikit-v2-text, #fff);
    box-shadow: var(--uiv2-panel-shadow, 0 24px 64px rgba(0, 0, 0, 0.55));
  }

  .pp-health-sheet__title {
    margin: 0 0 0.75rem;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .pp-health-sheet__scroll {
    flex: 1 1 auto;
    min-height: 0;
  }

  .pp-health-sheet__body {
    margin-bottom: 0.35rem;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--uiv2-fg-soft, #d7d7db);
  }

  .pp-health-sheet__body :global(p) {
    margin: 0 0 0.65rem;
  }

  .pp-health-sheet__content-label {
    margin-top: 0.75rem !important;
    color: var(--uiv2-fg-muted, #aaa);
  }

  .pp-health-sheet__lead {
    margin: 0 0 0.85rem;
    color: var(--uikit-v2-text, #fff);
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .pp-health-sheet__sections {
    display: flex;
    flex-direction: column;
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.045);
    overflow: hidden;
  }

  .pp-health-sheet__section {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.75rem;
  }

  .pp-health-sheet__section + .pp-health-sheet__section {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .pp-health-sheet__section-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--uiv2-fg-soft, #d7d7db) 55%, transparent);
  }

  .pp-health-sheet__section-value {
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--uikit-v2-text, #fff);
    overflow-wrap: anywhere;
  }

  .pp-health-sheet__section-value :global(a) {
    color: var(--uikit-v2-accent, #8ab4f8);
  }

  .pp-health-sheet__content {
    margin-bottom: 0.6rem;
    font-weight: 600;
    color: var(--uikit-v2-text, #fff);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .pp-health-sheet__content :global(a) {
    color: var(--uikit-v2-accent, #8ab4f8);
  }

  .pp-health-sheet__reason {
    margin-top: 0.5rem;
    color: var(--uiv2-fg-muted, #aaa);
    font-size: 0.82rem;
  }

  .pp-health-sheet__tip {
    margin-top: 0.75rem;
    margin-bottom: 0.85rem;
    font-size: 0.82rem;
    color: var(--uiv2-fg-muted, #aaa);
  }

  .pp-health-sheet__tip a {
    color: var(--uikit-v2-accent, #8ab4f8);
  }
</style>
