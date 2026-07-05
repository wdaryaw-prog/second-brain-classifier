а// api/classify.js
// Единая точка входа для "Шеринг в Second Brain".
// Принимает либо сырое изображение (Content-Type: image/*),
// либо JSON { text, url, tags } для ссылок/текста.
// Всегда возвращает чистый JSON — никакого ручного base64/regex на стороне Shortcuts.

export const config = {
  api: {
    bodyParser: false, // читаем тело сами — нужно для сырых байт картинки
  },
};

const TYPES = [
  "Zettel/мысль",
  "Идея-извне",
  "Паттерн-обо-мне",
  "Зерно для контента",
];

const SYSTEM_PROMPT = `Ты классифицируешь входящий контент для персональной базы знаний (second brain) в Obsidian.

Типы (выбери ровно один):
- "Zettel/мысль" — собственная мысль, наблюдение, инсайт автора
- "Идея-извне" — идея/факт/цитата из внешнего источника (статья, пост, видео)
- "Паттерн-обо-мне" — наблюдение о своём поведении, привычке, реакции
- "Зерно для контента" — сырьё для будущего поста/видео/рубрики

Правило для тегов (is_new_tag):
Сравнивай каждый предложенный тег со списком существующих тегов ТОЛЬКО по точному строковому совпадению (case-insensitive), не по смыслу. Если дословного совпадения в списке нет — это новый тег.

Верни СТРОГО JSON и ничего кроме него, без markdown-обёртки, без преамбулы. Формат:
{
  "type": "<один из четырёх типов выше>",
  "title": "<короткий заголовок, 3-7 слов>",
  "content": "<суть контента в markdown, 1-4 абзаца>",
  "tags": ["tag1", "tag2"],
  "new_tags": ["<подмножество tags, которых нет в списке существующих>"]
}`;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function extractJson(text) {
  // Claude иногда оборачивает ответ в ```json ... ``` несмотря на промпт — подчищаем на всякий случай
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not set on server" });
    return;
  }

  try {
    const contentType = req.headers["content-type"] || "";
    const raw = await readRawBody(req);

    let userContent; // содержимое user-сообщения для Claude
    let existingTags = [];

    if (contentType.startsWith("image/")) {
      // --- Ветка: картинка (screenshot) ---
      // Существующие теги передаются через query string: ?tags=tag1,tag2,tag3
      const url = new URL(req.url, `http://${req.headers.host}`);
      const tagsParam = url.searchParams.get("tags") || "";
      existingTags = tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const base64Data = raw.toString("base64"); // кодируем в Node — никаких хвостовых пробелов

      userContent = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: contentType,
            data: base64Data,
          },
        },
        {
          type: "text",
          text: `Существующие теги в базе: ${JSON.stringify(existingTags)}\n\nКлассифицируй скриншот выше.`,
        },
      ];
    } else {
      // --- Ветка: текст / ссылка ---
      const body = JSON.parse(raw.toString("utf-8") || "{}");
      const { text = "", link = "", tags = [] } = body;
      existingTags = tags;

      userContent = [
        {
          type: "text",
          text: `Существующие теги в базе: ${JSON.stringify(existingTags)}\n\n${
            link ? `Ссылка: ${link}\n` : ""
          }${text ? `Текст: ${text}` : ""}`,
        },
      ];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data });
      return;
    }

    const textBlock = data.content.find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No text block in Claude response", raw: data });
      return;
    }

    const parsed = extractJson(textBlock.text);

    // Подстраховка: гарантируем, что new_tags — реально подмножество tags по точному совпадению
    const existingLower = new Set(existingTags.map((t) => t.toLowerCase()));
    parsed.new_tags = (parsed.tags || []).filter(
      (t) => !existingLower.has(t.toLowerCase())
    );
    parsed.date = new Date().toISOString().slice(0, 10);

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
