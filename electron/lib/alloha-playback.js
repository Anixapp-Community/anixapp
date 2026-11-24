'use strict';

const { BrowserWindow, session } = require('electron');
const { createServer } = require('node:http');

let resolverSession;
const pending = new Map();

function getResolverSession() {
  if (resolverSession) return resolverSession;
  resolverSession = session.fromPartition('anix-alloha-resolver');
  resolverSession.webRequest.onBeforeSendHeaders({ urls: ['https://alloha.yani.tv/*'] }, (details, done) => {
    const requestHeaders = { ...details.requestHeaders };
    for (const name of Object.keys(requestHeaders)) {
      if (name.toLowerCase() === 'referer') delete requestHeaders[name];
    }
    requestHeaders.Referer = 'https://yani.tv/';
    done({ requestHeaders });
  });
  resolverSession.webRequest.onCompleted({ urls: ['https://*.userplay.live/*'] }, (details) => {
    if (details.statusCode !== 200 || !details.frame) return;
    try {
      const manifest = new URL(details.url);
      if (new URL(details.frame.url).origin !== 'https://alloha.yani.tv'
        || !manifest.pathname.endsWith('/master.m3u8')) return;
      pending.get(details.webContentsId)?.(manifest.href);
    } catch { /* The source document may have closed. */ }
  });
  return resolverSession;
}

function resolveAllohaStream(embedUrl) {
  const url = new URL(embedUrl);
  if (url.origin !== 'https://alloha.yani.tv') return null;
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: getResolverSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const { webContents } = window;
    const id = webContents.id;
    const src = url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    const html = `<!doctype html><iframe src="${src}" allow="autoplay" width="960" height="540"></iframe>`;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    const finish = (manifest = null) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      server.close();
      if (!window.isDestroyed()) window.destroy();
      resolve(manifest);
    };
    const timer = setTimeout(finish, 9000);
    pending.set(id, finish);
    window.once('closed', () => finish());
    webContents.setAudioMuted(true);
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    server.once('error', () => finish());
    server.listen(0, '127.0.0.1', () => {
      if (!pending.has(id)) return;
      const origin = `http://127.0.0.1:${server.address().port}`;
      webContents.on('will-navigate', (event) => event.preventDefault());
      void window.loadURL(origin).catch(() => finish());
    });
  });
}

module.exports = { resolveAllohaStream };
