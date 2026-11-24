<script lang="ts">
  import { navigate } from '../stores/navigation';
  import { requireAuth } from '../stores/auth';
  import { notifyBookmarksChanged } from '../utils/favorites-events';
  import UiV2CollectionCard from './uikit-v2/UiV2CollectionCard.svelte';

  export interface CollectionCardData {
    id: number;
    title: string;
    image?: string;
    description?: string;
    releaseCount?: number;
    notesCount?: number;
    commentCount?: number;
    bookmarksCount?: number;
    favoritesCount?: number;
    /** Сколько релизов коллекции уже просмотрено — для «Совпадение N%» */
    watchedCount?: number;
    creatorLogin?: string;
    creatorAvatar?: string;
    isFavorite?: boolean;
    isPrivate?: boolean;
  }

  interface Props {
    data: CollectionCardData;
    /** Обложка с подписью поверх (по умолчанию) или постер с подписью снизу — для хаба коллекций */
    layout?: 'overlay' | 'poster';
    /** Для layout="poster": широкая карточка (карусель и сетка) или компактная («Созданные вами») */
    variant?: 'wide' | 'small';
    showMenu?: boolean;
  }

  let { data, layout = 'poster', variant = 'wide', showMenu = true }: Props = $props();

  function handleClick() {
    navigate(`/collection/${data.id}`);
  }

  function handleFavoriteChange(next: boolean) {
    if (!requireAuth() || !data.id) return;
    const api = window.anixApi;
    if (!api) return;
    (next ? api.collection.addFavorite(data.id) : api.collection.removeFavorite(data.id))
      .then(() => notifyBookmarksChanged({ kind: 'collections' }))
      .catch(() => {});
  }
</script>

<UiV2CollectionCard
  data={{
    id: data.id,
    title: data.title,
    image: data.image,
    releaseCount: data.releaseCount ?? data.bookmarksCount,
    notesCount: data.notesCount,
    commentCount: data.commentCount,
    favoritesCount: data.favoritesCount,
    watchedCount: data.watchedCount,
    creatorLogin: data.creatorLogin,
    creatorAvatar: data.creatorAvatar,
    isFavorite: data.isFavorite,
    isPrivate: data.isPrivate,
  }}
  {layout}
  {variant}
  {showMenu}
  onclick={handleClick}
  onFavoriteChange={handleFavoriteChange}
/>
