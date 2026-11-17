'use strict';

const { Tray, nativeImage, Menu, app, ipcMain } = require('electron');
const state = require('../lib/app-state');
const config = require('../lib/config-store');
const logger = require('../logger');
const downloadQueue = require('../lib/download-queue');
const { createMainWindow, showMainWindowAndSend } = require('./main-window');
const { getMacTrayIconPath } = require('../lib/paths');
const {
  mapHistoryItems,
  countActiveDownloads,
  trayTooltip,
  buildTrayTemplate,
} = require('../lib/tray-menu');

const REFRESH_DEBOUNCE_MS = 400;
const DOWNLOADS_POLL_MS = 5000;
const POSTER_CACHE_LIMIT = 30;
// Постер в пункте меню: на macOS под высоту строки с подписью, на Windows — стандартные 16px.
const POSTER_SIZE = process.platform === 'darwin' ? 18 : 16;

function createTray(deps) {
  const { getIconPath, getAnixart } = deps;

  function getTrayImage() {
    if (state._trayImage) return state._trayImage;
    // macOS: template-значок сам перекрашивается под светлую и тёмную строку меню.
    if (process.platform === 'darwin') {
      const templatePath = getMacTrayIconPath();
      const template = templatePath ? nativeImage.createFromPath(templatePath) : null;
      if (template && !template.isEmpty()) {
        template.setTemplateImage(true);
        state._trayImage = template;
        return state._trayImage;
      }
    }
    const iconPath = getIconPath();
    if (!iconPath) return null;
    // Windows: .ico с размерами 16–256 — система сама берёт нужный под масштаб экрана.
    if (process.platform === 'win32' && iconPath.endsWith('.ico')) {
      state._trayImage = iconPath;
      return state._trayImage;
    }
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return null;
    const traySize = process.platform === 'linux' ? 22 : 16;
    state._trayImage = image.resize({ width: traySize, height: traySize });
    return state._trayImage;
  }

  const image = getTrayImage();
  if (!image) return;

  state.tray = new Tray(image);
  state.tray.setToolTip('AnixApp');

  const showWindow = () => {
    // macOS: окно может быть закрыто при живом приложении — создаём заново
    if (!state.mainWindow) {
      createMainWindow(deps);
      return;
    }
    state.mainWindow.show();
    state.mainWindow.focus();
  };

  // macOS: клик по значку открывает меню — показывать окно одновременно с ним не нужно.
  if (process.platform !== 'darwin') {
    state.tray.on('click', showWindow);
    state.tray.on('double-click', showWindow);
  }

  const model = {
    loggedIn: false,
    history: [],
    icons: {},
    accounts: [],
    activeDownloads: 0,
    unreadNotifications: 0,
  };

  const actions = {
    openWindow: showWindow,
    openRelease: (id) => showMainWindowAndSend(deps, 'anix:deepLink', { type: 'release', id }),
    openSettings: () => showMainWindowAndSend(deps, 'app:openSettings'),
    // Разделы, поиск и аккаунты обрабатывает главное окно — тем же путём, что меню приложения.
    send: (payload) => showMainWindowAndSend(deps, 'app:menuNavigate', payload),
    quit: () => { state.isQuitting = true; app.quit(); },
  };

  function rebuild() {
    if (!state.tray || state.tray.isDestroyed()) return;
    state.tray.setContextMenu(Menu.buildFromTemplate(buildTrayTemplate(model, actions, process.platform)));
    state.tray.setToolTip(trayTooltip(model));
  }

  // Постеры: квадрат из верхней части обложки, с отдельной картинкой для Retina.
  const posterCache = new Map();

  async function loadPoster(url) {
    if (posterCache.has(url)) return posterCache.get(url);
    let icon = null;
    try {
      const { fetchRemoteImage } = require('../cdn-proxy');
      const { data } = await fetchRemoteImage(url);
      const source = nativeImage.createFromBuffer(Buffer.from(data));
      if (!source.isEmpty()) {
        const { width, height } = source.getSize();
        const side = Math.min(width, height);
        const square = source.crop({
          x: Math.floor((width - side) / 2),
          y: Math.floor((height - side) / 3),
          width: side,
          height: side,
        });
        icon = nativeImage.createEmpty();
        for (const scaleFactor of [1, 2]) {
          const size = POSTER_SIZE * scaleFactor;
          const png = square.resize({ width: size, height: size, quality: 'best' }).toPNG();
          icon.addRepresentation({ scaleFactor, buffer: png });
        }
      }
    } catch (err) {
      logger.warn('tray', `poster failed: ${err?.message || err}`);
    }
    if (posterCache.size >= POSTER_CACHE_LIMIT) posterCache.delete(posterCache.keys().next().value);
    posterCache.set(url, icon);
    return icon;
  }

  async function loadPosters(items) {
    const icons = {};
    if (process.platform === 'linux') return icons;
    await Promise.all(items.map(async (item) => {
      if (!item.poster) return;
      const icon = await loadPoster(item.poster);
      if (icon) icons[item.id] = icon;
    }));
    return icons;
  }

  let historyProfileId = 0;

  async function loadHistory(profileId) {
    try {
      const response = await getAnixart().endpoints.release.getHistory(0);
      return mapHistoryItems(response);
    } catch (err) {
      logger.warn('tray', `history failed: ${err?.message || err}`);
      // Сеть недоступна — оставляем прошлый список, если он того же аккаунта.
      return profileId === historyProfileId ? model.history : [];
    }
  }

  // Пересборка с данными: последний запуск выигрывает, устаревшие ответы отбрасываются.
  let generation = 0;
  let refreshTimer = null;
  let pendingHistory = false;

  function readSession() {
    const cfg = config.loadConfig();
    const profileId = Number(cfg.profileId) || 0;
    let accounts = [];
    try {
      accounts = require('../lib/accounts-store').listAccountsPublic();
    } catch (err) {
      logger.warn('tray', `accounts failed: ${err?.message || err}`);
    }
    return { profileId, loggedIn: Boolean(cfg.token) && profileId > 0, accounts };
  }

  async function refreshNow(withHistory) {
    const current = ++generation;
    const { profileId, loggedIn, accounts } = readSession();

    let history = model.history;
    let icons = model.icons;
    if (!loggedIn) {
      history = [];
      icons = {};
    } else if (withHistory || profileId !== historyProfileId) {
      history = await loadHistory(profileId);
      icons = await loadPosters(history);
    }
    if (current !== generation) return;

    model.loggedIn = loggedIn;
    model.accounts = accounts;
    model.history = history;
    model.icons = icons;
    historyProfileId = loggedIn ? profileId : 0;
    if (!loggedIn) model.unreadNotifications = 0;
    rebuild();
  }

  function scheduleRefresh(withHistory) {
    pendingHistory = pendingHistory || withHistory;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const history = pendingHistory;
      pendingHistory = false;
      void refreshNow(history);
    }, REFRESH_DEBOUNCE_MS);
  }

  // Главное окно сообщает о смене аккаунта, новой записи в истории и непрочитанных уведомлениях.
  ipcMain.on('tray:sync', (event, payload) => {
    if (event.sender !== state.mainWindow?.webContents) return;
    const unread = Number(payload?.unreadNotifications);
    if (Number.isFinite(unread) && unread >= 0) model.unreadNotifications = Math.floor(unread);
    scheduleRefresh(payload?.history === true);
  });

  // Число загрузок меняется без участия окна — сверяем очередь, пересобираем только при изменении.
  const downloadsTimer = setInterval(() => {
    let count;
    try {
      count = countActiveDownloads(downloadQueue.getQueueSnapshot());
    } catch {
      return;
    }
    if (count === model.activeDownloads) return;
    model.activeDownloads = count;
    rebuild();
  }, DOWNLOADS_POLL_MS);
  app.once('will-quit', () => clearInterval(downloadsTimer));

  // Сразу — меню без истории (вход и аккаунты читаются локально), история догружается следом.
  const session = readSession();
  model.loggedIn = session.loggedIn;
  model.accounts = session.accounts;
  rebuild();
  scheduleRefresh(true);
}

module.exports = { createTray };
