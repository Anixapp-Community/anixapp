type CoverListener = (visible: boolean) => void;

const viewports = new WeakMap<Element, {
  observer: IntersectionObserver;
  items: Map<Element, CoverListener>;
}>();

function observeCover(root: Element, img: HTMLImageElement, update: CoverListener) {
  let viewport = viewports.get(root);
  if (!viewport) {
    const items = new Map<Element, CoverListener>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) items.get(entry.target)?.(entry.isIntersecting);
    }, { root });
    viewport = { items, observer };
    viewports.set(root, viewport);
  }
  const { observer, items } = viewport;
  items.set(img, update);
  observer.observe(img);
  return () => {
    observer.unobserve(img);
    items.delete(img);
    if (!items.size) {
      observer.disconnect();
      viewports.delete(root);
    }
  };
}

export function cachedCover(img: HTMLImageElement, url: string) {
  const on = 'watch-modal__episode-cover--on';
  const alternate = img.classList.contains('watch-modal__episode-cover--alt');
  const card = img.closest<HTMLElement>('.watch-modal__episode-card');
  const root = img.closest('.page__scroll');
  const observed = !!root && typeof IntersectionObserver !== 'undefined';
  let visible = !observed;
  let request: AbortController | undefined;
  let blobUrl: string | undefined;
  let current = url;
  let failed = false;
  let retried = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  img.loading = observed ? 'eager' : 'lazy';

  function clearRequest() {
    request?.abort();
    request = undefined;
    img.removeAttribute('src');
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = undefined;
  }

  function schedule() {
    clearTimeout(timer);
    const active = !alternate || card?.matches(':hover, :focus-within, :has([data-tv-focus="true"])');
    img.fetchPriority = !alternate ? 'high' : 'low';
    if (!active || !visible) {
      if (!img.classList.contains(on) && !(img.complete && img.naturalWidth > 0)) clearRequest();
      return;
    }
    if (failed) {
      if (!retried) {
        timer = setTimeout(() => {
          retried = true;
          failed = false;
          clearRequest();
          void start();
        }, 650);
      }
    } else if (!request && !img.hasAttribute('src')) {
      void start();
    }
  }

  async function start() {
    if (!observed) {
      img.src = current;
      return;
    }
    const controller = new AbortController();
    request = controller;
    try {
      const options = {
        signal: controller.signal,
        priority: alternate ? 'low' as const : 'high' as const,
      };
      const response = await fetch(current, options);
      if (!response.ok) throw new Error(`Cover HTTP ${response.status}`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      blobUrl = URL.createObjectURL(blob);
      img.src = blobUrl;
    } catch (error) {
      if (controller.signal.aborted) return;
      // Permit direct image loading on servers that disallow cross-origin fetch.
      if (error instanceof TypeError) img.src = current;
      else onError();
    } finally {
      if (request === controller) request = undefined;
    }
  }

  const show = () => img.classList.add(on);
  const onError = () => {
    failed = true;
    schedule();
  };
  img.addEventListener('load', show);
  img.addEventListener('error', onError);
  const unobserve = observed && root ? observeCover(root, img, (intersects) => {
    visible = intersects;
    schedule();
  }) : undefined;
  const interactionEvents = ['pointerenter', 'pointerleave', 'focusin', 'focusout'];
  if (alternate) for (const event of interactionEvents) card?.addEventListener(event, schedule);
  // TV focus is represented by an attribute and may not move DOM focus.
  const tvFocus = alternate && card?.closest('.watch-modal--tv') && typeof MutationObserver !== 'undefined'
    ? new MutationObserver(schedule) : undefined;
  if (tvFocus && card) tvFocus.observe(card, { subtree: true, attributes: true, attributeFilter: ['data-tv-focus'] });
  schedule();

  return {
    update(next: string) {
      if (current === next) return;
      current = next;
      failed = retried = false;
      img.classList.remove(on);
      clearRequest();
      schedule();
    },
    destroy() {
      clearTimeout(timer);
      clearRequest();
      unobserve?.();
      tvFocus?.disconnect();
      if (alternate) for (const event of interactionEvents) card?.removeEventListener(event, schedule);
      img.removeEventListener('load', show);
      img.removeEventListener('error', onError);
    },
  };
}
