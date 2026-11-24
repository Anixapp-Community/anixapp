<script lang="ts">
  import { banAlert, closeBanAlert } from '../stores/ban-alert';

  const alert = $derived($banAlert);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && alert) {
      e.preventDefault();
      closeBanAlert();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if alert}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="ban-alert-overlay" role="presentation" onclick={closeBanAlert}>
    <div
      class="ban-alert uikit-v2"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ban-alert-title"
      aria-describedby="ban-alert-message"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 class="ban-alert__title" id="ban-alert-title">{alert.title}</h2>
      <p class="ban-alert__message" id="ban-alert-message">{alert.message}</p>
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" class="ban-alert__btn" autofocus onclick={closeBanAlert}>
        {alert.ok}
      </button>
    </div>
  </div>
{/if}

<style>
  .ban-alert-overlay {
    position: fixed;
    inset: 0;
    z-index: 10050;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--uiv2-overlay, rgba(0, 0, 0, 0.62));
    animation: ban-alert-fade 0.14s ease;
  }

  .ban-alert {
    box-sizing: border-box;
    width: min(100%, 24rem);
    padding: 1.15rem 1.25rem 1rem;
    border: 1px solid var(--uiv2-panel-border, transparent);
    border-radius: 20px;
    background: var(--uiv2-panel-bg, #1c1d22);
    color: var(--uiv2-fg-strong, var(--color-text, #e8e8ec));
    box-shadow: var(--uiv2-panel-shadow, 0 24px 64px rgba(0, 0, 0, 0.55));
    animation: ban-alert-in 0.16s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .ban-alert__title {
    margin: 0 0 0.5rem;
    font-size: 1.02rem;
    font-weight: 700;
    line-height: 1.25;
  }

  .ban-alert__message {
    margin: 0 0 1.1rem;
    color: var(--uiv2-fg-soft, color-mix(in srgb, currentColor 80%, transparent));
    font-size: 0.88rem;
    line-height: 1.45;
  }

  .ban-alert__btn {
    display: block;
    margin-left: auto;
    min-height: 2.25rem;
    padding: 0.45rem 1.1rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--uikit-v2-accent, var(--color-accent, #9ba8ff));
    font: inherit;
    font-size: 0.9rem;
    font-weight: 650;
    cursor: pointer;
    transition: background 0.14s ease;
  }

  .ban-alert__btn:hover {
    background: color-mix(in srgb, var(--color-accent, #7c8cff) 14%, transparent);
  }

  .ban-alert__btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent, #7c8cff) 60%, transparent);
    outline-offset: 2px;
  }

  @keyframes ban-alert-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes ban-alert-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }
</style>
