import { COMMENT_RULES_URL } from './commentRules';
import { sanitizeArticleHtml } from './article-block-format';

export type HealthTab = 'account' | 'content';

export type ProfileHealthStatus = {
  banCount: number;
  banFor3MonthCount: number;
  lastBanTimestamp: number;
  lastBanExpires: number;
  blogSuspensionExpires: number;
  blogMuteExpires: number;
};

export type ProfileEnforcementItem = {
  id: number;
  type: string;
  reason: string | null;
  creationTimestamp: number;
  expirationTimestamp: number | null;
  isRevoked: boolean;
  entityId: number | null;
  entity: Record<string, unknown> | null;
  changes: Array<{ type: string; new_value?: unknown }>;
  appealType: string;
  appealStatus: string;
  appealExpiresTimestamp: number | null;
  raw: Record<string, unknown>;
};

/** Текст диалога «Как это работает» — дословно из APK (R.string.status_info). */
export const PROFILE_HEALTH_INFO_HTML = `
<p>Здесь видно, как модерация относится к вашему аккаунту: действуют ли сейчас ограничения, сколько было банов и что модераторы делали с вашим контентом.</p>
<p><strong>Что на странице</strong></p>
<p>- Состояние аккаунта и число банов за всё время и за последние 3 месяца</p>
<p>- Текущие ограничения: блокировка аккаунта, публикация в блоге и показ его записей в общей ленте, со сроками</p>
<p>- История модерации: во вкладке «Аккаунт» — баны и ограничения блога, во вкладке «Контент» — правки и удаления ваших записей, коллекций и комментариев</p>
<p>Нажмите на запись истории, чтобы узнать подробности.</p>
<p><strong>Что ограничивается во время бана</strong></p>
<p>При нарушении правил сообщества на ваш аккаунт могут быть наложены временные ограничения:</p>
<p>- написание комментариев</p>
<p>- создание коллекций</p>
<p>- публикация записей</p>
<p>- изменение аватара и обложки</p>
<p>- смена имени пользователя</p>
<p>- обновление статуса</p>
<p>Ограничения действуют указанный срок, после чего автоматически снимаются.</p>
<p><strong>Апелляция</strong></p>
<p>Если вы не согласны с решением, нажмите «Подать апелляцию» в нужной записи истории. Модераторы рассмотрят обращение и примут решение.</p>
<p><strong>Важно:</strong> систематические нарушения правил могут привести к перманентной блокировке аккаунта.</p>
`.trim();

export { COMMENT_RULES_URL };

const MONTHS_SHORT = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'нояб.', 'дек.'];

function asTs(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toMs(ts: number): number {
  return ts > 1e12 ? ts : ts * 1000;
}

function isActiveExpire(ts: number): boolean {
  if (!ts || ts <= 0) return false;
  return toMs(ts) > Date.now();
}

/** «27 нояб. 23:00» — SimpleDateFormat("d MMM HH:mm") из оригинала. */
export function formatHealthDateTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(toMs(ts));
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${time}`;
}

/** «23 нояб.» / «23 нояб. 2025» — как Time.II111lII1I(j, "d MMM", "yyyy"). */
export function formatHealthDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(toMs(ts));
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function normalizeHealthStatus(raw: Record<string, unknown> | null | undefined): ProfileHealthStatus {
  return {
    banCount: Number(raw?.ban_count ?? 0) || 0,
    banFor3MonthCount: Number(raw?.ban_for_3_month_count ?? 0) || 0,
    lastBanTimestamp: asTs(raw?.last_ban_timestamp),
    lastBanExpires: asTs(raw?.last_ban_expires),
    blogSuspensionExpires: asTs(raw?.blog_suspension_expires),
    blogMuteExpires: asTs(raw?.blog_mute_expires),
  };
}

export type HealthTone = 'red' | 'orange' | 'green';

export function isCurrentlyBanned(status: ProfileHealthStatus): boolean {
  return isActiveExpire(status.lastBanExpires);
}

export function isRestricted(status: ProfileHealthStatus): boolean {
  return !isCurrentlyBanned(status)
    && (isActiveExpire(status.blogSuspensionExpires) || isActiveExpire(status.blogMuteExpires));
}

export function healthTone(status: ProfileHealthStatus): HealthTone {
  if (isCurrentlyBanned(status)) return 'red';
  if (isRestricted(status)) return 'orange';
  return 'green';
}

/** «Аккаунт заблокирован» / «Есть ограничения» / «Всё в порядке». */
export function healthStatusTitle(status: ProfileHealthStatus): string {
  if (isCurrentlyBanned(status)) return 'Аккаунт заблокирован';
  if (isRestricted(status)) return 'Есть ограничения';
  return 'Всё в порядке';
}

/** «Блокировка действует до …» / «Сейчас ограничений нет» / «Банов не было — так держать». */
export function healthStatusNote(status: ProfileHealthStatus): string {
  if (isCurrentlyBanned(status)) {
    return status.lastBanExpires > 0
      ? `Блокировка действует до ${formatHealthDateTime(status.lastBanExpires)}`
      : 'Блокировка действует';
  }
  if (isRestricted(status)) return 'Для вашего блога сейчас действуют ограничения';
  return status.banCount > 0 ? 'Сейчас ограничений нет' : 'Банов не было — так держать';
}

export type HealthRestrictionRow = { title: string; until: string };

/** Строка ограничения блога: показывается только пока срок не истёк. */
export function blogSuspensionRow(status: ProfileHealthStatus): HealthRestrictionRow | null {
  if (!isActiveExpire(status.blogSuspensionExpires)) return null;
  return {
    title: 'Публикации в блоге запрещены',
    until: `до ${formatHealthDateTime(status.blogSuspensionExpires)}`,
  };
}

export function blogMuteRow(status: ProfileHealthStatus): HealthRestrictionRow | null {
  if (!isActiveExpire(status.blogMuteExpires)) return null;
  return {
    title: 'Блог скрыт из общей ленты',
    until: `до ${formatHealthDateTime(status.blogMuteExpires)}`,
  };
}

/** Плитка «Последний бан»: скрыта, если банов не было. */
export function lastBanTile(status: ProfileHealthStatus): string | null {
  if (status.lastBanTimestamp <= 0) return null;
  return formatHealthDate(status.lastBanTimestamp);
}

export function normalizeEnforcementList(data: unknown): ProfileEnforcementItem[] {
  if (Array.isArray(data)) {
    return data
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(normalizeEnforcement);
  }
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  const nested =
    (Array.isArray(obj.content) && obj.content)
    || (Array.isArray(obj.enforcements) && obj.enforcements)
    || (Array.isArray(obj.items) && obj.items)
    || [];
  return nested
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(normalizeEnforcement);
}

export function normalizeEnforcement(raw: Record<string, unknown>): ProfileEnforcementItem {
  const changes = Array.isArray(raw.changes)
    ? raw.changes.filter((c): c is { type: string; new_value?: unknown } => !!c && typeof c === 'object')
    : [];
  const entity =
    raw.entity && typeof raw.entity === 'object' && !Array.isArray(raw.entity)
      ? (raw.entity as Record<string, unknown>)
      : null;
  const appealExpires = raw.appeal_expires_timestamp ?? raw.appealExpiresTimestamp;
  return {
    id: Number(raw.id ?? 0),
    type: String(raw.type ?? ''),
    reason: typeof raw.reason === 'string' ? raw.reason : raw.reason == null ? null : String(raw.reason),
    creationTimestamp: asTs(raw.creation_timestamp ?? raw.creationTimestamp),
    expirationTimestamp: raw.expiration_timestamp != null || raw.expirationTimestamp != null
      ? asTs(raw.expiration_timestamp ?? raw.expirationTimestamp)
      : null,
    isRevoked: !!(raw.is_revoked ?? raw.isRevoked),
    entityId: raw.entity_id != null || raw.entityId != null
      ? Number(raw.entity_id ?? raw.entityId)
      : null,
    entity,
    changes,
    appealType: String(raw.appeal_type ?? raw.appealType ?? '').toUpperCase(),
    appealStatus: String(raw.appeal_status ?? raw.appealStatus ?? '').toUpperCase(),
    appealExpiresTimestamp: appealExpires != null ? asTs(appealExpires) : null,
    raw,
  };
}

/** Дедлайн модерации: «24 сент. 00:00» */
export function formatEnforcementDeadline(timestamp: number): string {
  return formatHealthDateTime(timestamp);
}

/** Нужно исправить контент до дедлайна (Android AppealType.ADJUSTMENT). */
export function isAdjustmentRequired(item: ProfileEnforcementItem): boolean {
  if (item.isRevoked) return false;
  if (item.appealType !== 'ADJUSTMENT') return false;
  if (item.appealStatus !== 'NOT_SUBMITTED') return false;
  return isActiveExpire(item.appealExpiresTimestamp ?? 0);
}

export function isExpiringActive(item: ProfileEnforcementItem): boolean {
  if (item.isRevoked) return false;
  if (!item.expirationTimestamp || item.expirationTimestamp <= 0) return true;
  return toMs(item.expirationTimestamp) > Date.now();
}

/** Плашка состояния записи истории: «Действует» / «Отменено» / null. */
export function enforcementStateLabel(item: ProfileEnforcementItem): string | null {
  if (item.isRevoked) return 'Отменено';
  if (isExpiringActive(item)) return 'Действует';
  return null;
}

export function enforcementEmptyText(tab: HealthTab): { title: string; summary: string } {
  return tab === 'account'
    ? {
        title: 'Всё в порядке',
        summary: 'Здесь появится информация об ограничениях вашего аккаунта в случае нарушения правил',
      }
    : {
        title: 'Всё в порядке',
        summary: 'Здесь появится история изменений или удалений ваших записей, комментариев и коллекций, если они нарушат правила',
      };
}

export function enforcementTargetPath(item: ProfileEnforcementItem): string | null {
  const entity = item.entity;
  const nestedArticleId = (() => {
    if (!entity) return null;
    const direct = Number(entity.article_id ?? entity.articleId ?? 0);
    if (direct > 0) return direct;
    const article = entity.article;
    if (article && typeof article === 'object') {
      const id = Number((article as { id?: unknown }).id ?? 0);
      if (id > 0) return id;
    }
    return null;
  })();

  switch (item.type) {
    case 'article_edit': {
      const id = item.entityId ?? nestedArticleId;
      return id && id > 0 ? `/article/${id}` : null;
    }
    case 'article_comment_edit': {
      const id = nestedArticleId ?? item.entityId;
      return id && id > 0 ? `/article/${id}` : null;
    }
    case 'collection_edit':
    case 'collection_comment_edit': {
      const collectionId = (() => {
        if (!entity) return item.entityId;
        const direct = Number(entity.collection_id ?? entity.collectionId ?? 0);
        if (direct > 0) return direct;
        const collection = entity.collection;
        if (collection && typeof collection === 'object') {
          const id = Number((collection as { id?: unknown }).id ?? 0);
          if (id > 0) return id;
        }
        return item.entityId;
      })();
      return collectionId && collectionId > 0 ? `/collection/${collectionId}` : null;
    }
    case 'release_comment_edit': {
      const releaseId = (() => {
        if (!entity) return item.entityId;
        const direct = Number(entity.release_id ?? entity.releaseId ?? 0);
        if (direct > 0) return direct;
        const release = entity.release;
        if (release && typeof release === 'object') {
          const id = Number((release as { id?: unknown }).id ?? 0);
          if (id > 0) return id;
        }
        return item.entityId;
      })();
      return releaseId && releaseId > 0 ? `/release/${releaseId}` : null;
    }
    default:
      return null;
  }
}

export function enforcementGoTargetLabel(item: ProfileEnforcementItem): string {
  switch (item.type) {
    case 'collection_edit':
      return 'К коллекции';
    case 'article_comment_edit':
    case 'collection_comment_edit':
    case 'release_comment_edit':
      return 'К комменту';
    default:
      return 'К записи';
  }
}

function articleAction(item: ProfileEnforcementItem): 'deleted' | 'restored' | 'edited' {
  const del = item.changes.find((c) => c.type === 'is_deleted');
  if (del) {
    if (del.new_value === true || del.new_value === 1 || del.new_value === 'true') return 'deleted';
    if (del.new_value === false || del.new_value === 0 || del.new_value === 'false') return 'restored';
  }
  return 'edited';
}

function entityRef(item: ProfileEnforcementItem): string {
  const id = item.entityId ?? item.id;
  return id > 0 ? `#${id}` : '';
}

export function enforcementListTitle(item: ProfileEnforcementItem): string {
  const ref = entityRef(item);
  if (isAdjustmentRequired(item)) {
    const until = item.appealExpiresTimestamp
      ? ` до ${formatEnforcementDeadline(item.appealExpiresTimestamp)}`
      : '';
    switch (item.type) {
      case 'article_edit':
        return `Требуется действие для записи ${ref}${until}`.trim();
      case 'collection_edit':
        return `Требуется действие для коллекции ${ref}${until}`.trim();
      case 'article_comment_edit':
        return `Требуется действие для комментария к записи ${ref}${until}`.trim();
      case 'collection_comment_edit':
        return `Требуется действие для комментария к коллекции ${ref}${until}`.trim();
      case 'release_comment_edit':
        return `Требуется действие для комментария к релизу ${ref}${until}`.trim();
      default:
        return `Требуется действие ${ref}${until}`.trim();
    }
  }
  switch (item.type) {
    case 'article_edit': {
      const a = articleAction(item);
      if (a === 'deleted') return `Удалена запись ${ref}`.trim();
      if (a === 'restored') return `Восстановлена запись ${ref}`.trim();
      return `Отредактирована запись ${ref}`.trim();
    }
    case 'article_comment_edit':
      return `Удалён комментарий к записи ${ref}`.trim();
    case 'release_comment_edit':
      return `Удалён комментарий к релизу ${ref}`.trim();
    case 'collection_comment_edit':
      return `Удалён комментарий к коллекции ${ref}`.trim();
    case 'collection_edit':
      return `Изменена коллекция ${ref}`.trim();
    case 'profile_ban':
      if (item.isRevoked) return `Разбан${ref ? ` ${ref}` : ''}`;
      if (!item.expirationTimestamp) return 'Бан бессрочно';
      return `Бан до ${formatHealthDateTime(item.expirationTimestamp)}`;
    case 'channel_suspension':
      if (!item.expirationTimestamp) return 'Ограничена публикация в блоге бессрочно';
      return `Ограничена публикация в блоге до ${formatHealthDateTime(item.expirationTimestamp)}`;
    case 'channel_mute':
      if (!item.expirationTimestamp) return 'Скрыты публикации из блога бессрочно';
      return `Скрыты публикации из блога до ${formatHealthDateTime(item.expirationTimestamp)}`;
    default:
      return item.reason?.trim() || 'Модерационное действие';
  }
}

export function enforcementListHint(item: ProfileEnforcementItem): string {
  if (isAdjustmentRequired(item) && item.appealExpiresTimestamp) {
    const until = formatEnforcementDeadline(item.appealExpiresTimestamp);
    if (item.type === 'collection_edit') {
      return `Внесите исправление до ${until}, иначе коллекция будет удалена безвозвратно`;
    }
    if (
      item.type === 'article_comment_edit'
      || item.type === 'collection_comment_edit'
      || item.type === 'release_comment_edit'
    ) {
      return `Внесите исправление до ${until}, иначе комментарий будет удалён безвозвратно`;
    }
    return `Внесите исправление до ${until}, иначе запись будет удалена безвозвратно`;
  }
  return item.reason?.trim() || '';
}

/** «От 23 нояб. 05:13» */
export function enforcementTimeLabel(item: ProfileEnforcementItem): string {
  if (!item.creationTimestamp) return '';
  return formatHealthDateTime(item.creationTimestamp);
}

export function extractArticleText(entity: Record<string, unknown> | null): string {
  if (!entity) return '';
  if (typeof entity.message === 'string' && entity.message.trim()) return entity.message.trim();
  if (typeof entity.title === 'string' && entity.title.trim()) return entity.title.trim();
  const payload = entity.payload;
  if (payload && typeof payload === 'object') {
    const blocks = (payload as { blocks?: unknown }).blocks;
    if (Array.isArray(blocks)) {
      const texts: string[] = [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        const data = (b as { data?: Record<string, unknown> }).data;
        const t = data?.text ?? data?.content ?? (b as { text?: unknown }).text;
        if (typeof t === 'string' && t.trim()) texts.push(t.trim());
      }
      if (texts.length) return texts.join('\n');
    }
  }
  return '';
}

/** Безопасный HTML для диалога: emoji-сущности, <b>/<br>, переносы блоков. */
export function formatEnforcementContentHtml(raw: string): string {
  const withBreaks = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '<br>');
  return sanitizeArticleHtml(withBreaks);
}

export function extractChannelLogin(entity: Record<string, unknown> | null): string {
  if (!entity) return '';
  const channel = entity.channel;
  if (channel && typeof channel === 'object') {
    const login = (channel as { login?: unknown; name?: unknown }).login
      ?? (channel as { name?: unknown }).name;
    if (typeof login === 'string' && login.trim()) return login.trim();
  }
  if (typeof entity.channel_login === 'string') return entity.channel_login;
  return '';
}

export function enforcementDetailTitle(item: ProfileEnforcementItem): string {
  if (isAdjustmentRequired(item)) return 'Требуется действие';
  if (item.type === 'article_edit') {
    const a = articleAction(item);
    if (a === 'deleted') return 'Удалена запись';
    if (a === 'restored') return 'Восстановлена запись';
    return 'Отредактирована запись';
  }
  if (item.type === 'profile_ban') return 'Блокировка аккаунта';
  if (item.type === 'channel_suspension') return 'Ограничение публикации';
  if (item.type === 'channel_mute') return 'Скрыты публикации';
  return enforcementListTitle(item);
}

export type EnforcementDetailSection = { label: string; value: string };

/** Структурированный текст диалога: вводная строка + подписанные блоки. */
export function enforcementDetailBody(item: ProfileEnforcementItem): {
  lead: string;
  sections: EnforcementDetailSection[];
} {
  const when = item.creationTimestamp ? formatHealthDateTime(item.creationTimestamp) : '';
  const reason = item.reason?.trim() || '';
  const text = extractArticleText(item.entity);
  const channel = extractChannelLogin(item.entity);
  const sections: EnforcementDetailSection[] = [];

  const pushReason = () => {
    if (reason) sections.push({ label: 'Причина', value: reason });
  };

  if (isAdjustmentRequired(item)) {
    const deadline = item.appealExpiresTimestamp
      ? formatEnforcementDeadline(item.appealExpiresTimestamp)
      : '';
    if (deadline) sections.push({ label: 'Исправить до', value: deadline });
    if (when) sections.push({ label: 'Выдано', value: when });
    pushReason();
    if (item.type === 'collection_edit') {
      return {
        lead: 'Ваша коллекция нарушает правила сообщества. Её нужно исправить, иначе она будет удалена навсегда.',
        sections,
      };
    }
    if (item.type.endsWith('_comment_edit')) {
      return {
        lead: 'Ваш комментарий нарушает правила сообщества. Его нужно исправить, иначе он будет удалён навсегда.',
        sections,
      };
    }
    return {
      lead: 'Ваша запись нарушает правила сообщества. Её нужно исправить, иначе она будет удалена навсегда.',
      sections,
    };
  }

  if (item.type === 'profile_ban') {
    if (when) sections.push({ label: 'Выдан', value: when });
    sections.push({
      label: 'Действует до',
      value: item.expirationTimestamp ? formatHealthDateTime(item.expirationTimestamp) : 'бессрочно',
    });
    pushReason();
    return { lead: 'На ваш аккаунт была наложена блокировка.', sections };
  }

  if (item.type === 'channel_suspension' || item.type === 'channel_mute') {
    const lead = item.type === 'channel_suspension'
      ? 'Публикации в вашем блоге ограничены.'
      : 'Публикации из вашего блога скрыты из общей ленты.';
    if (when) sections.push({ label: 'Выдано', value: when });
    sections.push({
      label: 'Действует до',
      value: item.expirationTimestamp ? formatHealthDateTime(item.expirationTimestamp) : 'бессрочно',
    });
    pushReason();
    return { lead, sections };
  }

  if (item.type === 'article_edit') {
    const a = articleAction(item);
    const verb = a === 'deleted' ? 'удалена' : a === 'restored' ? 'восстановлена' : 'изменена';
    if (when) sections.push({ label: 'Дата', value: when });
    pushReason();
    if (text) sections.push({ label: 'Содержание записи', value: text });
    return {
      lead: `Ваша запись${channel ? ` на канале «${channel}»` : ''} была ${verb}, поскольку нарушала правила сообщества.`,
      sections,
    };
  }

  if (item.type.endsWith('_comment_edit')) {
    const target = item.type === 'release_comment_edit'
      ? 'к релизу'
      : item.type === 'collection_comment_edit'
        ? 'к коллекции'
        : 'к записи';
    const ref = entityRef(item);
    if (when) sections.push({ label: 'Дата', value: when });
    pushReason();
    if (text) sections.push({ label: 'Содержание комментария', value: text });
    return {
      lead: `Ваш комментарий ${target}${ref ? ` ${ref}` : ''} был удалён, поскольку нарушал правила сообщества.`,
      sections,
    };
  }

  if (when) sections.push({ label: 'Дата', value: when });
  pushReason();
  return { lead: 'Модерационное действие с вашим контентом.', sections };
}
