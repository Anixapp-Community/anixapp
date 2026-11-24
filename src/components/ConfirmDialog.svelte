<script lang="ts">
  import { confirmState, resolveConfirm } from '../stores/confirm-dialog';

  const state = $derived($confirmState);

  function onKeydown(e: KeyboardEvent) {
    if (!state) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      resolveConfirm(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      resolveConfirm(true);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if state}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="confirm-overlay" role="presentation" onclick={() => resolveConfirm(false)}>
    <div
      class="confirm-dialog uikit-v2"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 class="confirm-dialog__title" id="confirm-title">{state.title}</h2>
      <p class="confirm-dialog__message" id="confirm-message">{state.message}</p>
      <div class="confirm-dialog__actions">
        <button
          type="button"
          class="confirm-dialog__btn"
          onclick={() => resolveConfirm(false)}
        >{state.cancelLabel ?? 'Отмена'}</button>
        <button
          type="button"
          class="confirm-dialog__btn confirm-dialog__btn--primary"
          class:confirm-dialog__btn--danger={state.danger}
          autofocus
          onclick={() => resolveConfirm(true)}
        >{state.confirmLabel ?? 'ОК'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 10055;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--uiv2-overlay, rgba(0, 0, 0, 0.62));
    animation: confirm-fade 0.14s ease;
  }

  .confirm-dialog {
    box-sizing: border-box;
    width: min(100%, 24rem);
    padding: 1.15rem 1.25rem 1rem;
    border: 1px solid var(--uiv2-panel-border, transparent);
    border-radius: 20px;
    background: var(--uiv2-panel-bg, #1c1d22);
    color: var(--uiv2-fg-strong, var(--color-text, #e8e8ec));
    box-shadow: var(--uiv2-panel-shadow, 0 24px 64px rgba(0, 0, 0, 0.55));
    animation: confirm-in 0.16s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .confirm-dialog__title {
    margin: 0 0 0.5rem;
    font-size: 1.02rem;
    font-weight: 700;
    line-height: 1.25;
  }

  .confirm-dialog__message {
    margin: 0 0 1.15rem;
    color: var(--uiv2-fg-soft, color-mix(in srgb, currentColor 80%, transparent));
    font-size: 0.88rem;
    line-height: 1.45;
  }

  .confirm-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .confirm-dialog__btn {
    min-height: 2.25rem;
    padding: 0.45rem 1.1rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--uiv2-fg-soft, color-mix(in srgb, currentColor 80%, transparent));
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .confirm-dialog__btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--uiv2-fg-strong, #fff);
  }

  .confirm-dialog__btn--primary {
    color: var(--uikit-v2-accent, var(--color-accent, #9ba8ff));
  }

  .confirm-dialog__btn--danger {
    color: #f2757a;
  }

  .confirm-dialog__btn--danger:hover {
    background: rgba(229, 72, 77, 0.16);
    color: #ff9a9d;
  }

  .confirm-dialog__btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent, #7c8cff) 60%, transparent);
    outline-offset: 2px;
  }

  @keyframes confirm-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes confirm-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }
</style>
