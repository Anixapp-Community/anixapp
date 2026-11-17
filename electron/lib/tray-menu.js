'use strict';

/**
 * Содержимое меню значка в трее — без Electron, чтобы проверять тестами.
 * Сверху последние просмотренные тайтлы, ниже разделы приложения, аккаунт и выход.
 */

const HISTORY_LIMIT = 5;
const TITLE_MAX_LENGTH = 48;
const POSTER_BASE = 'https://s.anixmirai.com/posters';
const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'starting', 'downloading', 'paused']);

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** URL маленького постера релиза; id без расширения достраивается до файла на CDN. */
function posterUrlFromRaw(raw) {
  const poster = raw?.poster;
  const value = str(poster?.small?.url) || str(poster?.medium?.url) || str(poster?.original?.url)
    || str(typeof poster === 'string' ? poster : '') || str(raw?.image);
  if (!value || value.startsWith('anix-cdn://') || value.startsWith('/')) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return /\.(jpe?g|png|webp)$/i.test(value) ? `${POSTER_BASE}/${value}` : `${POSTER_BASE}/${value}.jpg`;
}

/** Подпись серии как в истории приложения: «7» → «7 серия», название серии — как есть. */
function episodeLabel(lastEpisode) {
  const name = str(lastEpisode?.name);
  if (!name) return '';
  return /^\d+$/.test(name) ? `${Number(name)} серия` : name;
}

function dubberLabel(lastEpisode) {
  const source = lastEpisode?.source;
  return str(source?.type?.name) || str(source?.name);
}

/** Ответ `history` → до `limit` записей для меню, без повторов и записей без id. */
function mapHistoryItems(response, limit = HISTORY_LIMIT) {
  const list = Array.isArray(response) ? response : response?.content;
  if (!Array.isArray(list)) return [];
  const items = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const release = raw.release && typeof raw.release === 'object' ? raw.release : raw;
    const id = Number(release.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    const title = str(release.title_ru) || str(release.title_original) || str(release.title);
    if (!title) continue;
    const lastEpisode = raw.last_view_episode ?? release.last_view_episode;
    seen.add(id);
    items.push({
      id,
      title,
      episode: episodeLabel(lastEpisode),
      dubber: dubberLabel(lastEpisode),
      poster: posterUrlFromRaw(release),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** Загрузки, которые ещё идут или ждут очереди (ошибки и готовые не считаются). */
function countActiveDownloads(snapshot) {
  if (!Array.isArray(snapshot)) return 0;
  return snapshot.filter((job) => ACTIVE_DOWNLOAD_STATUSES.has(job?.status)).length;
}

function trayTooltip(model) {
  return model.activeDownloads > 0 ? `AnixApp — загрузки: ${model.activeDownloads}` : 'AnixApp';
}

function truncate(text, max = TITLE_MAX_LENGTH) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function withCount(label, count) {
  if (!(count > 0)) return label;
  return `${label} (${count > 99 ? '99+' : count})`;
}

/**
 * Шаблон для `Menu.buildFromTemplate`.
 * @param {{ loggedIn: boolean, history: Array, icons: Record<number, unknown>, accounts: Array,
 *   activeDownloads: number, unreadNotifications: number }} model
 * @param {{ openWindow: Function, openRelease: Function, openSettings: Function, send: Function,
 *   quit: Function }} actions — `send` уходит в главное окно как `app:menuNavigate`
 * @param {string} platform — `process.platform`
 */
function buildTrayTemplate(model, actions, platform) {
  const isMac = platform === 'darwin';
  // Windows и Linux считают «&» мнемоникой — в названиях тайтлов и логинах экранируем.
  const text = (value) => (isMac ? value : value.replace(/&/g, '&&'));
  const separator = { type: 'separator' };
  const template = [];

  if (model.loggedIn && model.history.length) {
    template.push({ label: 'Продолжить просмотр', enabled: false });
    for (const item of model.history) {
      const title = text(truncate(item.title));
      const entry = { click: () => actions.openRelease(item.id) };
      if (isMac) {
        entry.label = title;
        const sublabel = [item.episode, item.dubber].filter(Boolean).join(' · ');
        if (sublabel) entry.sublabel = text(sublabel);
      } else {
        entry.label = item.episode ? `${title} · ${text(item.episode)}` : title;
      }
      // В меню AppIndicator на Linux картинки показываются не везде — там только текст.
      const icon = platform === 'linux' ? undefined : model.icons?.[item.id];
      if (icon) entry.icon = icon;
      template.push(entry);
    }
    template.push({ label: 'Вся история', click: () => actions.send({ action: 'history' }) });
    template.push(separator);
  }

  template.push({ label: 'Открыть AnixApp', click: () => actions.openWindow() });
  template.push({ label: 'Поиск', click: () => actions.send({ action: 'search' }) });
  if (model.loggedIn) template.push({ label: 'Закладки', click: () => actions.send({ id: 'bookmarks' }) });
  template.push({ label: 'Расписание', click: () => actions.send({ action: 'schedule' }) });
  if (model.loggedIn) {
    template.push({
      label: withCount('Уведомления', model.unreadNotifications),
      click: () => actions.send({ action: 'notifications' }),
    });
  }
  template.push({
    label: withCount('Загрузки', model.activeDownloads),
    click: () => actions.send({ id: 'downloads' }),
  });
  template.push(separator);

  if (model.loggedIn) {
    const active = model.accounts.find((a) => a.active);
    const login = active ? text(str(active.login) || `ID ${active.id}`) : '';
    const submenu = model.accounts.map((account) => ({
      label: text(str(account.login) || `ID ${account.id}`),
      type: 'checkbox',
      checked: account.active === true,
      click: () => {
        if (!account.active) actions.send({ action: 'switchAccount', profileId: account.id });
      },
    }));
    if (submenu.length) submenu.push(separator);
    submenu.push({ label: 'Добавить аккаунт…', click: () => actions.send({ action: 'login' }) });
    submenu.push({ label: login ? `Выйти из ${login}` : 'Выйти', click: () => actions.send({ action: 'logout' }) });
    template.push({ label: login ? `Аккаунт: ${login}` : 'Аккаунт', submenu });
  } else {
    template.push({ label: 'Войти в аккаунт…', click: () => actions.send({ action: 'login' }) });
  }
  template.push(separator);

  template.push({ label: 'Настройки', click: () => actions.openSettings() });
  template.push({ label: isMac ? 'Завершить AnixApp' : 'Выход', click: () => actions.quit() });
  return template;
}

module.exports = {
  HISTORY_LIMIT,
  mapHistoryItems,
  posterUrlFromRaw,
  countActiveDownloads,
  trayTooltip,
  buildTrayTemplate,
};
