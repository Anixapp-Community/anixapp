// Original One Piece (1999). https://www.animefillerlist.com/shows/one-piece
const onePieceFiller = [
  [54, 60], [98, 99], [102, 102], [131, 143], [196, 206], [220, 225],
  [279, 283], [291, 292], [303, 303], [317, 319], [326, 336], [382, 384],
  [406, 407], [426, 429], [457, 458], [492, 492], [542, 542], [575, 578],
  [590, 590], [626, 627], [747, 750], [780, 782], [895, 896], [907, 907],
  [1029, 1030],
];

export function isFillerEpisode(
  releaseTitle: string,
  episode: { position: number; is_filler?: boolean; isFiller?: boolean },
): boolean {
  if (episode.is_filler === true || episode.isFiller === true) return true;
  if (!Number.isInteger(episode.position)) return false;
  const title = releaseTitle.trim().toLowerCase().replace(/[\s‐‑–—-]+/g, '');
  if (title !== 'onepiece' && title !== 'ванпис') return false;
  return onePieceFiller.some(([first, last]) => episode.position >= first && episode.position <= last);
}
