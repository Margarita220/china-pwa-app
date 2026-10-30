const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Твои неизменные ключи Hugging Face и ID таблицы
const HF_KEY = "59f1a50d90348988135bc4b83e4c60fe1468ccb1e02c87a1a73c429c94d70cfd";
const QWEN_URL = "https://huggingface.co";
const WHISPER_URL = "https://huggingface.co";
const SPREADSHEET_ID = "1ws50E1fPfEBZ4i5PzgA9y9mdEQhdVZP-K878jXFfSbs";

app.use(express.static(path.join(__dirname, 'public')));

// Функция скоростного скачивания листов таблицы без авторизации Google
async function fetchGlossaryFromSheets() {
  const sheets = [{ name: "вэд", type: "legal" }, { name: "культура", type: "culture" }, { name: "сленг", type: "slang" }];
  let vocabulary = [];
  
  for (const sheet of sheets) {
    try {
      // Формируем прямую ссылку экспорта конкретного листа в формате CSV
      const url = `https://google.com{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeText(sheet.name)}`;
      const response = await axios.get(url);
      const lines = response.data.split('\n');
      
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        // Очищаем строки от кавычек, которые добавляет Google при экспорте
        const cells = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
        if (cells[0] && cells[1]) {
          vocabulary.push({ zh: cells[0], ru: cells[1], type: sheet.type });
        }
      }
    } catch (e) { console.error(`Ошибка загрузки листа ${sheet.name}:`, e.message); }
  }
  return vocabulary;
}

function encodeText(text) { return encodeURIComponent(text); }

// Эндпоинт умного перевода по контексту
app.post('/api/translate', async (req, res) => {
  const { text, direction } = req.body;
  if (!text) return res.status(400).send("Текст пуст");

  try {
    const glossary = await fetchGlossaryFromSheets();
    let matchedTerms = [];
    let hasLegal = false, hasSlang = false, hasCulture = false;

    glossary.forEach(item => {
      let isMatch = false;
      if (direction === "zh-ru") {
        if (text.includes(item.zh)) isMatch = true;
        else if ((item.zh === "挤水份" || item.zh === "挤水分") && text.includes("挤") && (text.includes("水份") || text.includes("水分"))) isMatch = true;
      } else if (direction === "ru-zh" && text.toLowerCase().includes(item.ru.toLowerCase())) {
        isMatch = true;
      }

      if (isMatch) {
        matchedTerms.push(`"${item.zh}" переводится как "${item.ru}"`);
        if (item.type === "legal") hasLegal = true;
        if (item.type === "culture") hasCulture = true;
        if (item.type === "slang") hasSlang = true;
      }
    });

    let targetLang = (direction === "zh-ru") ? "русский" : "китайский (иероглифы путунхуа)";
    let systemRole = "Ты — высококвалифицированный эксперт на стыке лингвистики, юриспруденции и экономики в сфере ВЭД РФ-КНР.";
    let instruction = ` Сделай прямой, естественный перевод текста на ${targetLang} язык. Переводи ЖИВО И ПО КОНТЕКСТУ, избегай калькирования. Не пиши никаких вводных фраз, пояснений и кавычек. Выдавай ТОЛЬКО готовый перевод.`;

    if (hasSlang) systemRole = "Ты — харизматичный эксперт по китайскому интернет-сленгу. Переводи живым, разговорным стилем.";
    else if (hasCulture && !hasLegal) systemRole = "Ты — специалист по культуре КНР. Дешифруй образный переносный смысл чэнъюев и устойчивых выражений.";
    else if (hasLegal) systemRole = "Ты — юрист-международник. Твой стиль — строгий, официально-деловой. Переводи точно для документов.";

    let finalPrompt = systemRole + instruction;
    if (matchedTerms.length > 0) finalPrompt += "\nОБЯЗАТЕЛЬНО используй эти точные значения терминов, гладко встроив их в контекст предложения:\n" + matchedTerms.join("\n");

    const response = await axios.post(QWEN_URL, {
      model: "Qwen/Qwen2.5-72B-Instruct",
      messages: [{ role: "system", content: finalPrompt }, { role: "user", content: text }],
      temperature: 0.15
    }, { headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "application/json" } });

    res.json({ translation: response.data.choices[0].message.content.trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Эндпоинт нативного распознавания голоса Whisper
app.post('/api/voice', async (req, res) => {
  const { base64Audio } = req.body;
  if (!base64Audio) return res.status(400).send("Аудио отсутствует");

  try {
    const buffer = Buffer.from(base64Audio, 'base64');
    const response = await axios.post(WHISPER_URL, buffer, {
      headers: { "Authorization": `Bearer ${HF_KEY}`, "Content-Type": "audio/wav" }
    });
    res.json({ text: response.data.text ? response.data.text.trim() : "Речь не распознана." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
