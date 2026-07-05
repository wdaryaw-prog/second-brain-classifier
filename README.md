# second-brain-classifier

Один Vercel-эндпоинт вместо ручной сборки JSON/base64 в Shortcuts.
Та же схема, что и у vocab-srs: секретный ключ живёт только на сервере,
Shortcut просто шлёт запрос и получает готовый JSON.

## Деплой (как с vocab-srs)

1. Создай новый репозиторий на GitHub (например `second-brain-classifier`),
   запушь эту папку.
2. На vercel.com → New Project → импортируй репозиторий.
3. В Settings → Environment Variables добавь:
   `ANTHROPIC_API_KEY` = твой ключ с console.anthropic.com
4. Deploy. Получишь URL вида `https://second-brain-classifier.vercel.app`.

## Что теперь меняется в самом Shortcut

Убираешь целиком: `Encode Media with base64`, оба Replace для base64,
Text-экшен с ручной сборкой JSON, все Set Variable для CleanBase64/StrippedBase64,
Count/Show debug-шаги.

### Ветка "картинка" (Otherwise, если InputURL пустой)

1. `Get Contents of URL`
   - URL: `https://second-brain-classifier.vercel.app/api/classify?tags=` + (список тегов через запятую, если есть)
   - Method: POST
   - Headers: `Content-Type` → передай нужный media type, обычно `image/png`
   - Request Body: **File** → выбери Resized Image напрямую (не текст!)
2. Результат — уже готовый словарь (Get Dictionary from Input не нужен,
   Shortcuts сам распознает JSON-ответ). Дальше просто читай `type`, `title`,
   `content`, `tags`, `new_tags`, `date` через "Get Value for Key".

### Ветка "ссылка/текст" (If InputURL has value)

1. `Get Contents of URL`
   - URL: тот же эндпоинт, без query-параметра tags (или можно тоже добавить)
   - Method: POST
   - Request Body: **JSON** (нативный редактор словаря в Shortcuts, не Text!)
     - `text`: (входной текст, если есть)
     - `link`: InputURL
     - `tags`: список существующих тегов
2. Дальше так же — читаешь ключи из JSON-ответа.

## Почему это убирает баги

- Base64 кодируется в Node (`Buffer.toString('base64')`) — там физически
  не может появиться хвостовый пробел, который добавлял `Encode Media with base64`.
- JSON собирается через `JSON.stringify` в коде — никакого ручного
  экранирования кавычек/бэкслэшей/переносов строк через Replace Text regex.
- Нет коллизий "Updated Text" — переменные живут в JS, а не в цепочке чипов Shortcuts.
- Ошибки от Anthropic API возвращаются как есть в JSON — их видно сразу
  в Quick Look, без нужды лезть в webhook.site.

## Проверить руками до подключения Shortcut

```bash
curl -X POST https://second-brain-classifier.vercel.app/api/classify \
  -H "Content-Type: application/json" \
  -d '{"text":"тестовая мысль","tags":["ai-coaching","obsidian"]}'
```

Если вернулся JSON с `type`/`title`/`content` — всё работает, можно
переключать Shortcut.
