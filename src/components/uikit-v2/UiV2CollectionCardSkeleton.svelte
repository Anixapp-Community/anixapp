<script lang="ts">
  import UiV2Skeleton from './UiV2Skeleton.svelte';

  type Props = {
    count?: number;
    class?: string;
    /** `poster` — карточка хаба: обложка сверху, подпись снизу */
    layout?: 'overlay' | 'poster';
    /** Без обёртки-сетки: элементы кладутся прямо в сетку страницы */
    bare?: boolean;
  };

  let { count = 1, class: className = '', layout = 'poster', bare = false }: Props = $props();
</script>

{#snippet deck()}
  <div class="uiv2-collection__deck" aria-hidden="true">
    <span class="uiv2-collection__sheet uiv2-collection__sheet--back"></span>
    <span class="uiv2-collection__sheet uiv2-collection__sheet--mid"></span>
  </div>
{/snippet}

{#snippet tile()}
  {#if layout === 'poster'}
    <article class="uiv2-collection-skeleton uiv2-collection-skeleton--poster">
      {@render deck()}
      <UiV2Skeleton tag="div" class="uiv2-collection-skeleton__media uiv2-collection-skeleton__media--poster" rounded="none" />
      <div class="uiv2-collection-skeleton__caption">
        <UiV2Skeleton tag="div" class="uiv2-collection-skeleton__title" rounded="sm" />
        <UiV2Skeleton tag="div" class="uiv2-collection-skeleton__meta" rounded="sm" />
      </div>
    </article>
  {:else}
    <article class="uiv2-collection-skeleton">
      {@render deck()}
      <div class="uiv2-collection-skeleton__card">
        <UiV2Skeleton tag="div" class="uiv2-collection-skeleton__media" rounded="none" />
        <div class="uiv2-collection-skeleton__overlay">
          <UiV2Skeleton tag="div" class="uiv2-collection-skeleton__title" rounded="sm" />
          <UiV2Skeleton tag="div" class="uiv2-collection-skeleton__meta" rounded="sm" />
        </div>
      </div>
    </article>
  {/if}
{/snippet}

{#if bare}
  {#each Array.from({ length: count }) as _, i (i)}
    {@render tile()}
  {/each}
{:else}
  <div class="uiv2-collection-skeleton-wrap {className}" aria-busy="true" aria-label="Загрузка коллекций">
    {#each Array.from({ length: count }) as _, i (i)}
      {@render tile()}
    {/each}
  </div>
{/if}
