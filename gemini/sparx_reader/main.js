require('dotenv').config();
const { generateContentWithFallback } = require('../generate');

const DEFAULT_MODELS = require('../modelDiscovery').REQUESTED_MODELS;


function getModels() {
  const configured = String(process.env.GEMINI_READER_MODELS || '').split(',').map(v => v.trim()).filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

function normaliseOptions(questionOptions, incorrectAnswers) {
  const options = (Array.isArray(questionOptions) ? questionOptions : [])
    .map(o => typeof o === 'string' ? o : (o?.text ?? o?.label ?? o?.answer ?? o?.value ?? ''))
    .map(String)
    .map(o => o.trim())
    .filter(Boolean);

  const blocked = new Set((Array.isArray(incorrectAnswers) ? incorrectAnswers : [])
    .map(String)
    .map(o => o.trim()));

  return options.filter(o => !blocked.has(o));
}

function normaliseText(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseAnswer(raw, options) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  // Exact text always wins.
  const exact = options.find(option => normaliseText(option) === normaliseText(text));
  if (exact) return exact;

  // Prefer an explicit answer marker before looking for arbitrary numbers in
  // an explanation. This avoids selecting a story/question number by mistake.
  const explicitNumber = text.match(/(?:^|\b)(?:answer|option)(?:\s+is)?\s*(?:option\s*)?(?::|=)?\s*([1-9]\d*)\b/i);
  const standaloneNumber = text.match(/^\s*([1-9]\d*)\s*[.)]?\s*$/);
  const numberMatch = explicitNumber || standaloneNumber;
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    if (index >= 0 && index < options.length) return options[index];
  }

  const explicitLetter = text.match(/(?:^|\b)(?:answer|option)(?:\s+is)?\s*(?:option\s*)?(?::|=)?\s*([A-Z])\b/i);
  const standaloneLetter = text.match(/^\s*([A-Z])\s*[.)]?\s*$/i);
  const letterMatch = explicitLetter || standaloneLetter;
  if (letterMatch) {
    const index = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < options.length) return options[index];
  }

  // Some providers still return the full option text with a short explanation.
  // Only accept a unique option occurrence; ambiguous partial matches are rejected.
  const lowered = normaliseText(text);
  const contained = options.filter(option => lowered.includes(normaliseText(option)));
  return contained.length === 1 ? contained[0] : null;
}

function isTransient(err) {
  const status = Number(err?.status ?? err?.code ?? err?.response?.status);
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function answerQuestionAi(apiKey, extract, question, questionOptions, incorrectAnswers = []) {
  const options = normaliseOptions(questionOptions, incorrectAnswers);
  if (!options.length) throw new Error('Reader returned no usable answer options.');

  // Keep the prompt bounded without throwing away the end of a long passage.
  // Reader questions can refer to details near either end of the extract.
  const rawExtract = String(extract ?? '').trim();
  const safeExtract = rawExtract.length <= 18000
    ? rawExtract
    : `${rawExtract.slice(0, 9000)}\n\n[...middle of passage omitted for size...]\n\n${rawExtract.slice(-9000)}`;
  const numbered = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
  const prompt = [
    'Choose the correct answer to this Sparx Reader question.',
    'Use the passage and question together. Return ONLY the option number (for example: 2). Do not explain your choice.',
    '',
    `Story:\n${safeExtract}`,
    '',
    `Question:\n${String(question ?? '').trim()}`,
    '',
    `Options:\n${numbered}`
  ].join('\n');

  const models = getModels();
  let lastError;
  for (const model of models) {
    try {
      const generated = await generateContentWithFallback({ apiKey, model, models: [model], contents: prompt });
      const answer = parseAnswer(generated.response?.text, options);
      if (answer) return answer;
      lastError = new Error(`Gemini returned an unrecognised Reader answer from ${model}: ${String(generated.response?.text ?? '')}`);
    } catch (err) {
      lastError = err;
      const status = Number(err?.status ?? err?.code ?? err?.response?.status);
      if (status === 401) throw err;
      // Probe the next candidate for model-level errors, throttling, and outages.
    }
  }

  throw lastError || new Error('No Gemini Reader model was available.');
}

module.exports = { answerQuestionAi, normaliseOptions, parseAnswer };
