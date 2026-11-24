<script lang="ts">
  import { accountBan, accountBanTitle, isAccountBanActive } from '../stores/account-ban';

  type Props = { size?: number };

  let { size = 16 }: Props = $props();

  const state = $derived($accountBan);
  let now = $state(Date.now());
  const active = $derived(isAccountBanActive(state, now));
  const title = $derived(accountBanTitle(state));

  // Пока бан активен — пересчитываем срок, чтобы бейдж гас сам, без перезапуска.
  $effect(() => {
    if (!active) return;
    const id = setInterval(() => { now = Date.now(); }, 30_000);
    return () => clearInterval(id);
  });
</script>

{#if active}
  <span
    class="account-ban-badge"
    style:--ban-badge-size={`${size}px`}
    role="img"
    aria-label={title}
    title={title}
  >!</span>
{/if}

<style>
  .account-ban-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--ban-badge-size, 16px);
    height: var(--ban-badge-size, 16px);
    border-radius: 50%;
    border: 2px solid var(--uiv2-bg, #101114);
    background: #e5484d;
    color: #fff;
    font-size: calc(var(--ban-badge-size, 16px) * 0.62);
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
  }
</style>
