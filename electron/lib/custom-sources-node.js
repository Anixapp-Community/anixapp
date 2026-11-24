'use strict';

const { fetchMediaProbe } = require('./media-proxy');

let customSources;

function getCustomSources() {
  const desktop = Boolean(process.versions.electron);
  customSources ??= import('./custom-sources.mjs').then(({ createCustomSources }) =>
    createCustomSources({
      fetchMedia: fetchMediaProbe,
      ...(desktop && {
        fetchMedia: require('./source-stream-protocol').fetchSourceStream,
        resolveAlloha: require('./alloha-playback').resolveAllohaStream,
        prepareStream: require('./source-stream-protocol').sourceStreamUrl,
      }),
      aniTypeToken: process.env.ANITYPE_ENABLED === 'true' ? process.env.ANITYPE_TOKEN?.trim() : '',
    }));
  return customSources;
}

module.exports = { getCustomSources };
