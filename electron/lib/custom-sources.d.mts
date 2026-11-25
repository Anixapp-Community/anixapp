type ReleaseEndpoints = {
  info(releaseId: number, extended: boolean): Promise<unknown>;
  getDubbers(releaseId: number): Promise<unknown>;
  getDubberSources(releaseId: number, dubberId: number): Promise<unknown>;
  getEpisodes(releaseId: number, dubberId: number, sourceId: number, sort?: number): Promise<unknown>;
  getEpisode(releaseId: number, sourceId: number, position: number): Promise<unknown>;
};

export function createCustomSources(options?: {
  fetcher?: typeof fetch;
  fetchMedia?: typeof fetch;
  aniLibToken?: string;
  animeLibVideoBaseUrl?: string;
  animeLibVideoPathPrefix?: string;
  resolveAlloha?: (url: string) => Promise<string | null>;
  resolveAnimeLibStream?: (url: string) => Promise<string | null>;
  prepareStream?: (url: string) => string | null;
}): {
  getDubbersOfficial?(release: ReleaseEndpoints, releaseId: number): Promise<unknown>;
  getDubbers(release: ReleaseEndpoints, releaseId: number): Promise<unknown>;
  getDubberSources(release: ReleaseEndpoints, releaseId: number, dubberId: number): Promise<unknown>;
  getEpisodes(release: ReleaseEndpoints, releaseId: number, dubberId: number, sourceId: number, sort?: number): Promise<unknown>;
  getEpisode(release: ReleaseEndpoints, releaseId: number, sourceId: number, position: number, preferEmbed?: boolean): Promise<unknown>;
};

export function isCustomSourceId(value: unknown): boolean;

export function supportsSourceWebPlayer(value: unknown): boolean;
