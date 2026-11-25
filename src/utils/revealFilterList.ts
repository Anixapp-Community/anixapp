import { cubicIn, quintOut } from 'svelte/easing';

export function revealFilterList(_node: HTMLElement, { upward, fromRight = false, closing = false }: { upward: boolean; fromRight?: boolean; closing?: boolean }) {
  return {
    duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : closing ? 180 : 290,
    easing: closing ? cubicIn : quintOut,
    css: (t: number) => {
      const horizontal = `max(0px, calc(${(1 - t) * 100}% - ${(1 - t) * 36}px))`;
      const vertical = `max(0px, calc(${(1 - t) * 100}% - ${(1 - t) * 16}px))`;
      const top = upward ? vertical : '0px';
      const bottom = upward ? '0px' : vertical;
      return `clip-path: inset(${top} ${fromRight ? 0 : horizontal} ${bottom} ${fromRight ? horizontal : 0} round 14px); opacity: ${Math.min(1, t * 3)};`;
    },
  };
}
