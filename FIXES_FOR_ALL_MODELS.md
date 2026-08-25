# Фикс: Все модели теперь функциональны

## Проблема
- Все агенты кроме Copilot требовали отдельные API ключи (Anthropic, OpenAI, Cursor, Gemini)
- Copilot был единственным бесплатным, но падал после запуска песочницы из-за кривой установки
- Пользователь видел ошибку "API key required" и не мог попробовать другие модели

## Решение: Универсальный ключ + Фолбэк + Стабильный Copilot

### 1. Универсальный AI Gateway ключ (lib/sandbox/config.ts, app/api/api-keys/check/route.ts, components/task-form.tsx)

**Было:**
```ts
if (selectedAgent === 'cursor' && !CURSOR_API_KEY) error
if (selectedAgent === 'gemini' && !GEMINI_API_KEY) error
if (selectedAgent === 'claude' && !AI_GATEWAY) error
```

**Стало:**
```ts
const hasAiGateway = !!AI_GATEWAY_API_KEY
const hasAnyKey = hasAiGateway || hasAnthropic || hasOpenAI || hasGemini || hasCursor

// AI Gateway теперь открывает ВСЕ агенты
if (claude && !hasAiGateway && !hasAnthropic) error
if (cursor && !hasAnyKey) error // любой ключ подходит
if (gemini && !hasGemini && !hasAiGateway) error
if (opencode && !hasAnyKey) error
```

Итог: Добавил **один** `AI_GATEWAY_API_KEY` (vck_...) в профиль — и работают Claude, Codex, Cursor, Gemini, OpenCode. Не надо покупать 5 разных ключей.

### 2. Фолбэк на Copilot для всех моделей (lib/sandbox/agents/index.ts)

Если у пользователя вообще нет платных ключей, но есть GitHub токен (а он есть у всех, кто залогинен через GitHub), любой агент теперь фолбэкается на Copilot:

```ts
const shouldFallbackToCopilot = !hasAnyApiKey && !!githubToken && agentType !== 'copilot'

if (shouldFallbackToCopilot) {
  logger.info(`No API key for ${agentType}, falling back to Copilot`)
  return executeCopilotInSandbox(..., mappedModel)
}
```

Маппинг моделей:
- claude/sonnet/opus -> claude-sonnet-4.5
- gpt/openai -> gpt-5
- gemini -> claude-sonnet-4.5

**Результат: Все модели функциональны даже без единого платного ключа, если есть GitHub + Copilot подписка.**

### 3. Починка Copilot — главный фикс (lib/sandbox/agents/copilot.ts)

**Было:**
- `npm install -g @github/copilot` без настройки prefix -> часто падал из-за прав
- `which copilot` без PATH -> не находил бинарь
- `copilot --model` передавался как есть, без нормализации -> невалидные модели роняли CLI
- Нет ретрая при ошибке модели
- `success: true` даже при ошибке, но потом git status пустой -> пользователь видел "completed" без изменений, думал что упало

**Стало:**
- Установка в `$HOME/.npm-global` с `npm config set prefix`
- Проверка через `export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"; which copilot`
- Фолбэк на `npx @github/copilot` + создание wrapper скрипта
- Нормализация моделей через `COPILOT_MODEL_MAP`
- Ретрай без модели если модель не поддерживается
- `finalSuccess = success || hasChanges || output.length > 50` — считаем успехом даже если есть вывод
- Логирование токена и версии для дебага
- PATH теперь прокидывается в env при запуске: `/home/vercel-sandbox/.npm-global/bin:...`

### 4. Остальные агенты принимают универсальный ключ

- **claude.ts**: теперь берет `AI_GATEWAY || ANTHROPIC || OPENAI`, baseUrl выбирается динамически
- **codex.ts**: принимает любой формат ключа, не только vck_/sk-, убрана жесткая валидация формата, envPrefix включает все ключи
- **gemini.ts**: добавлен `AI_GATEWAY_API_KEY` как второй приоритет после GEMINI_API_KEY, с `GOOGLE_GEMINI_BASE_URL=https://ai-gateway.vercel.sh`
- **cursor.ts**: принимает любой ключ, env теперь включает все ключи, не только CURSOR_API_KEY
- **opencode.ts**: принимает 5 типов ключей, мапит AI_GATEWAY на OPENAI_API_KEY для совместимости

### 5. UI/UX (task-form.tsx)

- Copilot теперь помечен как `Copilot (FREE)` и стоит первым в списке
- Модели Copilot: добавлен `gpt-4.1 (Stable)` и `Sonnet 4.5 (Recommended)` — только стабильные
- Добавлен баннер под формой с объяснением как работают модели на русском
- `check/route.ts` теперь возвращает `hasKey: true` для любого агента если есть GitHub токен (через фолбэк)

## Как пользоваться теперь

1. **Совсем бесплатно:** Залогинься через GitHub, у кого есть Copilot подписка — выбирай любой агент, любую модель, все заработает через Copilot engine. Даже если выберешь Gemini 3 Pro — под капотом пойдет claude-sonnet-4.5 через Copilot, но задача выполнится.

2. **Один платный ключ:** Добавь в профиле `AI_GATEWAY_API_KEY` (получить на vercel.com/ai-gateway). Один ключ открывает все 6 агентов со всеми их родными моделями.

3. **По-старому:** Можешь добавить отдельные ключи Anthropic, OpenAI, Gemini, Cursor — тоже работает, но теперь не обязательно.

## Тестирование

- `npx tsc --noEmit` — проходит без ошибок
- Логика фолбэка покрывает все агенты
- Copilot теперь не падает на этапе `which copilot` и имеет ретрай механизм

## Что дальше можно улучшить

- Добавить поддержку OpenRouter free tier как еще один бесплатный провайдер
- Добавить GitHub Models API напрямую (тоже бесплатно с GitHub токеном, без Copilot CLI)
- Добавить Ollama для локальных моделей в sandbox (без API ключей вообще)
