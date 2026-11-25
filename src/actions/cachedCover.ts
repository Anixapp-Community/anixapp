/** Let the browser schedule and cache the versioned frame URLs. */
export function cachedCover(img: HTMLImageElement, url: string) {
  const visible = 'watch-modal__episode-cover--on';
  const instant = 'watch-modal__episode-cover--instant';
  const show = () => img.classList.add(visible);

  function update(next: string) {
    if (img.getAttribute('src') === next) return;
    img.classList.remove(visible, instant);
    img.src = next;
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add(instant);
      show();
    }
  }

  img.loading = 'lazy';
  img.addEventListener('load', show);
  update(url);
  return {
    update,
    destroy: () => img.removeEventListener('load', show),
  };
}
