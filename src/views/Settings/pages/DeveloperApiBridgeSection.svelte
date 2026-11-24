<script lang="ts">
  import UiV2SettingsToggle from '../../../components/uikit-v2/UiV2SettingsToggle.svelte';
  import { onMount } from 'svelte';

  interface BridgeStatus {
    available: boolean;
    enabled: boolean;
    port: number;
    token: string | null;
    hasAuth: boolean;
    login: string | null;
    running: boolean;
    baseUrl: string;
  }

  let status = $state<BridgeStatus | null>(null);
  let busy = $state(false);
  let feedback = $state('');
  let feedbackKind = $state<'ok' | 'err'>('ok');
  let showToken = $state(false);

  const exampleCall = $derived.by(() => {
    if (!status?.token) return '';
    return `curl -s -X POST ${status.baseUrl}/v1/call \\
  -H "Authorization: Bearer ${status.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"path":"profile.self","args":[]}'`;
  });

  function setFeedback(message: string, kind: 'ok' | 'err' = 'ok') {
    feedback = message;
    feedbackKind = kind;
  }

  async function refresh() {
    if (!window.electron?.getDevBridgeStatus) return;
    status = await window.electron.getDevBridgeStatus();
  }

  async function setEnabled(enabled: boolean) {
    if (!window.electron?.setDevBridgeEnabled) return;
    busy = true;
    feedback = '';
    try {
      status = await window.electron.setDevBridgeEnabled(enabled);
      setFeedback(enabled ? 'Мост включён' : 'Мост выключен');
    } catch {
      setFeedback('Не удалось изменить состояние моста', 'err');
    } finally {
      busy = false;
    }
  }

  async function regenerateToken() {
    if (!window.electron?.regenerateDevBridgeToken) return;
    busy = true;
    feedback = '';
    try {
      status = await window.electron.regenerateDevBridgeToken();
      setFeedback('Токен обновлён');
    } catch {
      setFeedback('Не удалось обновить токен', 'err');
    } finally {
      busy = false;
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('Скопировано');
    } catch {
      setFeedback('Не удалось скопировать', 'err');
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

<div class="settings-section developer-bridge">
  <p class="settings-section__label">API-мост для Cursor</p>
  <p class="settings-section__desc">
    Локальный HTTP-сервер на <code>127.0.0.1</code> — проксирует запросы к Anixart API с вашей сессией.
    Доступен только в dev-сборке. Выключайте, когда не используете.
  </p>

  {#if !status}
    <p class="developer-bridge__loading">Загрузка…</p>
  {:else if !status.available}
    <div class="developer-bridge__notice developer-bridge__notice--warn">
      Доступно только при запуске через <code>npm run electron:dev</code>.
    </div>
  {:else}
    <div class="settings-section__body">
      <UiV2SettingsToggle
        label="Включить API-мост"
        description={status.running ? `Запущен · ${status.baseUrl}` : status.enabled ? 'Сервер запускается' : 'Внешние запросы отклоняются'}
        checked={status.enabled}
        disabled={busy}
        onChange={(checked) => void setEnabled(checked)}
      />

      {#if !status.hasAuth}
        <div class="developer-bridge__notice developer-bridge__notice--warn">
          Войдите в аккаунт — мост использует токен текущей сессии.
        </div>
      {:else if status.login}
        <div class="settings-row settings-row--readonly">
          <div class="settings-row__info">
            <div class="settings-row__label">Сессия</div>
            <div class="settings-row__desc">{status.login}</div>
          </div>
        </div>
      {/if}

      {#if status.enabled && status.token}
        <p class="settings-section__sublabel">Bearer-токен</p>
        <div class="developer-bridge__token">
          <code class="developer-bridge__token-value">
            {showToken ? status.token : `${status.token.slice(0, 8)}…${status.token.slice(-6)}`}
          </code>
          <div class="developer-bridge__token-actions">
            <button
              type="button"
              class="settings-btn settings-btn--secondary"
              onclick={() => {
                showToken = !showToken;
              }}
            >
              {showToken ? 'Скрыть' : 'Показать'}
            </button>
            <button
              type="button"
              class="settings-btn settings-btn--secondary"
              onclick={() => void copyText(status?.token ?? '')}
            >
              Копировать
            </button>
            <button
              type="button"
              class="settings-btn settings-btn--secondary"
              disabled={busy}
              onclick={() => void regenerateToken()}
            >
              Новый токен
            </button>
          </div>
        </div>

        <p class="settings-section__sublabel">Пример запроса</p>
        <div class="developer-bridge__code-block">
          <div class="developer-bridge__code-toolbar">
            <span class="developer-bridge__code-label">curl</span>
            <button
              type="button"
              class="settings-btn settings-btn--secondary"
              onclick={() => void copyText(exampleCall)}
            >
              Копировать
            </button>
          </div>
          <pre class="developer-bridge__code"><code>{exampleCall}</code></pre>
        </div>

        <ul class="developer-bridge__endpoints" aria-label="Эндпоинты API-моста">
          <li>
            <code>GET /health</code>
            <span>Статус без токена</span>
          </li>
          <li>
            <code>GET /v1/methods</code>
            <span>Список частых методов</span>
          </li>
          <li>
            <code>POST /v1/call</code>
            <span>Тело: <code>{`{ "path": "profile.info", "args": [487033] }`}</code></span>
          </li>
        </ul>
      {/if}

      {#if feedback}
        <div class="settings-row--end">
          <p class="settings-feedback settings-feedback--{feedbackKind}">{feedback}</p>
        </div>
      {/if}
    </div>
  {/if}
</div>
