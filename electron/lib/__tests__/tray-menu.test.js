'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  mapHistoryItems,
  posterUrlFromRaw,
  countActiveDownloads,
  trayTooltip,
  buildTrayTemplate,
} = require('../tray-menu');

function historyRaw(id, extra = {}) {
  return {
    id,
    title_ru: `Тайтл ${id}`,
    image: `https://s.anixmirai.com/posters/${id}.jpg`,
    last_view_episode: { name: '7', source: { name: 'Плеер', type: { name: 'AniLibria' } } },
    ...extra,
  };
}

function makeActions() {
  const calls = [];
  return {
    calls,
    actions: {
      openWindow: () => calls.push(['openWindow']),
      openRelease: (id) => calls.push(['openRelease', id]),
      openSettings: () => calls.push(['openSettings']),
      send: (payload) => calls.push(['send', payload]),
      quit: () => calls.push(['quit']),
    },
  };
}

function baseModel(extra = {}) {
  return {
    loggedIn: true,
    history: [],
    icons: {},
    accounts: [{ id: 1, login: 'subliker', active: true }],
    activeDownloads: 0,
    unreadNotifications: 0,
    ...extra,
  };
}

const labels = (template) => template.filter((i) => i.type !== 'separator').map((i) => i.label);

describe('mapHistoryItems', () => {
  it('берёт первые 5 релизов из content, с серией и озвучкой', () => {
    const response = { content: [1, 2, 3, 4, 5, 6].map((id) => historyRaw(id)) };
    const items = mapHistoryItems(response);
    assert.equal(items.length, 5);
    assert.deepEqual(items[0], {
      id: 1,
      title: 'Тайтл 1',
      episode: '7 серия',
      dubber: 'AniLibria',
      poster: 'https://s.anixmirai.com/posters/1.jpg',
    });
  });

  it('понимает обёртку { release }, пропускает битые записи и повторы', () => {
    const response = {
      content: [
        { release: historyRaw(10) },
        historyRaw(10),
        { id: 0, title_ru: 'без id' },
        { id: 11 },
        null,
        historyRaw(12, { title_ru: '', title_original: 'Original' }),
      ],
    };
    const items = mapHistoryItems(response);
    assert.deepEqual(items.map((i) => i.id), [10, 12]);
    assert.equal(items[1].title, 'Original');
  });

  it('название серии оставляет как есть, без серии подписи нет', () => {
    const items = mapHistoryItems([
      historyRaw(1, { last_view_episode: { name: 'Фильм' } }),
      historyRaw(2, { last_view_episode: undefined }),
    ]);
    assert.equal(items[0].episode, 'Фильм');
    assert.equal(items[0].dubber, '');
    assert.equal(items[1].episode, '');
  });

  it('на мусор отвечает пустым списком', () => {
    assert.deepEqual(mapHistoryItems(undefined), []);
    assert.deepEqual(mapHistoryItems({ content: 'x' }), []);
  });
});

describe('posterUrlFromRaw', () => {
  it('предпочитает маленький постер и достраивает id до URL', () => {
    assert.equal(
      posterUrlFromRaw({ poster: { small: { url: 'https://cdn/x.jpg' }, original: { url: 'https://cdn/o.jpg' } } }),
      'https://cdn/x.jpg',
    );
    assert.equal(posterUrlFromRaw({ image: 'abc' }), 'https://s.anixmirai.com/posters/abc.jpg');
    assert.equal(posterUrlFromRaw({ image: 'abc.webp' }), 'https://s.anixmirai.com/posters/abc.webp');
  });

  it('прокси-ссылки и пустые значения не берёт', () => {
    assert.equal(posterUrlFromRaw({ image: 'anix-cdn://x' }), '');
    assert.equal(posterUrlFromRaw({}), '');
  });
});

describe('countActiveDownloads', () => {
  it('считает очередь, загрузку и паузу, но не ошибки и готовые', () => {
    const snapshot = ['queued', 'starting', 'downloading', 'paused', 'error', 'done', 'cancelled']
      .map((status) => ({ status }));
    assert.equal(countActiveDownloads(snapshot), 4);
    assert.equal(countActiveDownloads(null), 0);
  });
});

describe('trayTooltip', () => {
  it('добавляет число загрузок, только если они идут', () => {
    assert.equal(trayTooltip(baseModel()), 'AnixApp');
    assert.equal(trayTooltip(baseModel({ activeDownloads: 2 })), 'AnixApp — загрузки: 2');
  });
});

describe('buildTrayTemplate', () => {
  const history = mapHistoryItems([historyRaw(1), historyRaw(2)]);

  it('со входом: история сверху, затем разделы, аккаунт и выход', () => {
    const { actions } = makeActions();
    const t = buildTrayTemplate(baseModel({ history }), actions, 'win32');
    assert.deepEqual(labels(t), [
      'Продолжить просмотр',
      'Тайтл 1 · 7 серия',
      'Тайтл 2 · 7 серия',
      'Вся история',
      'Открыть AnixApp',
      'Поиск',
      'Закладки',
      'Расписание',
      'Уведомления',
      'Загрузки',
      'Аккаунт: subliker',
      'Настройки',
      'Выход',
    ]);
    assert.equal(t[0].enabled, false);
  });

  it('без входа: нет истории, закладок и уведомлений, есть «Войти»', () => {
    const { actions } = makeActions();
    const t = buildTrayTemplate(baseModel({ loggedIn: false, history, accounts: [] }), actions, 'linux');
    assert.deepEqual(labels(t), [
      'Открыть AnixApp',
      'Поиск',
      'Расписание',
      'Загрузки',
      'Войти в аккаунт…',
      'Настройки',
      'Выход',
    ]);
    assert.notEqual(t[0].type, 'separator');
  });

  it('без истории блок «Продолжить просмотр» не показывается', () => {
    const { actions } = makeActions();
    const t = buildTrayTemplate(baseModel(), actions, 'darwin');
    assert.equal(t[0].label, 'Открыть AnixApp');
  });

  it('macOS: серия в sublabel, постер иконкой, «Завершить AnixApp»', () => {
    const { actions } = makeActions();
    const icon = { fake: 'image' };
    const t = buildTrayTemplate(baseModel({ history, icons: { 1: icon } }), actions, 'darwin');
    const item = t.find((i) => i.label === 'Тайтл 1');
    assert.equal(item.sublabel, '7 серия · AniLibria');
    assert.equal(item.icon, icon);
    assert.equal(t.find((i) => i.label === 'Тайтл 2').icon, undefined);
    assert.equal(t[t.length - 1].label, 'Завершить AnixApp');
  });

  it('Linux: постеры не ставит', () => {
    const { actions } = makeActions();
    const t = buildTrayTemplate(baseModel({ history, icons: { 1: {} } }), actions, 'linux');
    assert.equal(t.find((i) => i.label === 'Тайтл 1 · 7 серия').icon, undefined);
  });

  it('счётчики уведомлений и загрузок в подписи, больше 99 — «99+»', () => {
    const { actions } = makeActions();
    const t = buildTrayTemplate(baseModel({ unreadNotifications: 150, activeDownloads: 2 }), actions, 'win32');
    assert.ok(labels(t).includes('Уведомления (99+)'));
    assert.ok(labels(t).includes('Загрузки (2)'));
  });

  it('Windows и Linux: «&» в названии экранируется, на macOS — нет', () => {
    const { actions } = makeActions();
    const amp = mapHistoryItems([historyRaw(5, { title_ru: 'Tom & Jerry', last_view_episode: null })]);
    assert.equal(buildTrayTemplate(baseModel({ history: amp }), actions, 'win32')[1].label, 'Tom && Jerry');
    assert.equal(buildTrayTemplate(baseModel({ history: amp }), actions, 'darwin')[1].label, 'Tom & Jerry');
  });

  it('длинное название обрезается многоточием', () => {
    const { actions } = makeActions();
    const long = mapHistoryItems([historyRaw(5, { title_ru: 'а'.repeat(80), last_view_episode: null })]);
    const label = buildTrayTemplate(baseModel({ history: long }), actions, 'darwin')[1].label;
    assert.equal(label.length, 48);
    assert.ok(label.endsWith('…'));
  });

  it('клики уходят в нужные действия', () => {
    const { actions, calls } = makeActions();
    const t = buildTrayTemplate(baseModel({ history }), actions, 'win32');
    const click = (label) => t.find((i) => i.label === label).click();
    click('Тайтл 1 · 7 серия');
    click('Вся история');
    click('Открыть AnixApp');
    click('Поиск');
    click('Закладки');
    click('Расписание');
    click('Уведомления');
    click('Загрузки');
    click('Настройки');
    click('Выход');
    assert.deepEqual(calls, [
      ['openRelease', 1],
      ['send', { action: 'history' }],
      ['openWindow'],
      ['send', { action: 'search' }],
      ['send', { id: 'bookmarks' }],
      ['send', { action: 'schedule' }],
      ['send', { action: 'notifications' }],
      ['send', { id: 'downloads' }],
      ['openSettings'],
      ['quit'],
    ]);
  });

  it('подменю аккаунта: галочка у активного, смена, добавление и выход', () => {
    const { actions, calls } = makeActions();
    const accounts = [
      { id: 1, login: 'subliker', active: true },
      { id: 2, login: 'alt', active: false },
    ];
    const t = buildTrayTemplate(baseModel({ accounts }), actions, 'darwin');
    const sub = t.find((i) => i.label === 'Аккаунт: subliker').submenu;
    assert.deepEqual(sub.filter((i) => i.type !== 'separator').map((i) => [i.label, i.checked]), [
      ['subliker', true],
      ['alt', false],
      ['Добавить аккаунт…', undefined],
      ['Выйти из subliker', undefined],
    ]);
    sub[0].click();
    sub[1].click();
    sub.find((i) => i.label === 'Добавить аккаунт…').click();
    sub.find((i) => i.label === 'Выйти из subliker').click();
    assert.deepEqual(calls, [
      ['send', { action: 'switchAccount', profileId: 2 }],
      ['send', { action: 'login' }],
      ['send', { action: 'logout' }],
    ]);
  });

  it('вход есть, а аккаунт не сохранён: подменю с «Выйти» без логина', () => {
    const { actions } = makeActions();
    const t = buildTrayTemplate(baseModel({ accounts: [] }), actions, 'win32');
    const acc = t.find((i) => i.label === 'Аккаунт');
    assert.ok(acc);
    assert.ok(acc.submenu.some((i) => i.label === 'Выйти'));
  });
});
