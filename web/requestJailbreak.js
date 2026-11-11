'use strict';

const MODELS = [
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', provider: 'Gemini', providerKey: 'gemini', description: 'Flagship reasoning model' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', provider: 'Gemini', providerKey: 'gemini', description: 'Advanced reasoning model' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Gemini', providerKey: 'gemini', description: 'Fast general-purpose model' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Gemini', providerKey: 'gemini', description: 'Balanced reasoning and speed' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Gemini', providerKey: 'gemini', description: 'General-purpose model' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Gemini', providerKey: 'gemini', description: 'Fast general-purpose model' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', provider: 'Gemini', providerKey: 'gemini', description: 'Lower-latency, efficient model' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', provider: 'Gemini', providerKey: 'gemini', description: 'Efficient lightweight model' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'Gemini', providerKey: 'gemini', description: 'Advanced problem-solving model' },

  { id: 'grok-4.7', name: 'Grok 4.7', provider: 'Grok', providerKey: 'grok', description: 'Flagship reasoning and coding model' },
  { id: 'grok-4.6', name: 'Grok 4.6', provider: 'Grok', providerKey: 'grok', description: 'Previous-generation flagship' },
  { id: 'grok-4.5', name: 'Grok 4.5', provider: 'Grok', providerKey: 'grok', description: 'General-purpose reasoning model' },
  { id: 'grok-4.3', name: 'Grok 4.3', provider: 'Grok', providerKey: 'grok', description: 'General-purpose model' },

  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', provider: 'Claude', providerKey: 'claude', description: 'Latest Fable family model' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'Claude', providerKey: 'claude', description: 'High-capability Opus model' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'Claude', providerKey: 'claude', description: 'Opus family model' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', provider: 'Claude', providerKey: 'claude', description: 'Opus family model' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'Claude', providerKey: 'claude', description: 'Opus family model' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Claude', providerKey: 'claude', description: 'Balanced performance model' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Claude', providerKey: 'claude', description: 'Balanced performance model' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'Claude', providerKey: 'claude', description: 'Fast, efficient model' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'Claude', providerKey: 'claude', description: 'Fast, efficient model' }
];

const MODEL_BY_ID = new Map(MODELS.map(model => [model.id, model]));

let modelCatalogCache = null;
const MODEL_CATALOG_CACHE_MS = 5 * 60 * 1000;

async function fetchCatalogueJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Provider model catalogue returned HTTP ${response.status}`);
  return response.json();
}

async function discoverModels() {
  if (modelCatalogCache && modelCatalogCache.expiresAt > Date.now()) return modelCatalogCache.models;

  const byProvider = { gemini: [], grok: [], claude: [] };
  const fallback = {
    gemini: MODELS.filter(model => model.providerKey === 'gemini'),
    grok: MODELS.filter(model => model.providerKey === 'grok'),
    claude: MODELS.filter(model => model.providerKey === 'claude')
  };

  const tasks = [];
  if (process.env.GEMINI_API_KEY) {
    tasks.push((async () => {
      try {
        const payload = await fetchCatalogueJson(
          'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
          { 'x-goog-api-key': process.env.GEMINI_API_KEY }
        );
        byProvider.gemini = (payload.models || [])
          .filter(model => (model.supportedGenerationMethods || []).includes('generateContent'))
          .map(model => ({
            id: String(model.name || '').replace(/^models\//, ''),
            name: model.displayName || String(model.name || '').replace(/^models\//, ''),
            provider: 'Gemini',
            providerKey: 'gemini',
            description: model.description || 'Gemini generative model'
          }))
          .filter(model => model.id && !/embedding|aqa/i.test(model.id));
      } catch {}
    })());
  }
  if (process.env.XAI_API_KEY) {
    tasks.push((async () => {
      try {
        const payload = await fetchCatalogueJson('https://api.x.ai/v1/models', {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`
        });
        byProvider.grok = (payload.data || [])
          .map(model => ({
            id: String(model.id || ''),
            name: String(model.id || ''),
            provider: 'Grok',
            providerKey: 'grok',
            description: 'Model available to the configured xAI API key'
          }))
          .filter(model => model.id && !/imagine|image|video|voice|audio|embedding|transcribe/i.test(model.id));
      } catch {}
    })());
  }
  if (process.env.ANTHROPIC_API_KEY) {
    tasks.push((async () => {
      try {
        const payload = await fetchCatalogueJson('https://api.anthropic.com/v1/models?limit=1000', {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        });
        byProvider.claude = (payload.data || [])
          .map(model => ({
            id: String(model.id || ''),
            name: model.display_name || model.id,
            provider: 'Claude',
            providerKey: 'claude',
            description: 'Model available to the configured Anthropic API key'
          }))
          .filter(model => model.id);
      } catch {}
    })());
  }

  await Promise.all(tasks);
  for (const key of Object.keys(byProvider)) {
    if (!byProvider[key].length) byProvider[key] = fallback[key];
  }
  const models = [...byProvider.gemini, ...byProvider.grok, ...byProvider.claude];
  modelCatalogCache = { models, expiresAt: Date.now() + MODEL_CATALOG_CACHE_MS };
  return models;
}


const SYSTEM_INSTRUCTION = [
  'You are Lumen Prompt Architect. Convert the user request into a detailed, ready-to-use prompt for the specified target AI model.',
  'Write the prompt in the target model’s preferred style, with a clear role, objective, relevant context, constraints, workflow, output format, and quality criteria.',
  'Preserve the user’s actual intent. Ask clarifying questions inside the generated prompt only when essential information is missing; otherwise state reasonable assumptions explicitly.',
  'Prompts may support legitimate creative, technical, research, educational, and professional work, including cybersecurity research.',
  'Do not create instructions whose purpose is to bypass, defeat, or disable another AI system’s safety policies or access controls. Do not request secrets, credentials, or private data.',
  'Return only the generated prompt, without preamble, commentary, markdown fences, or claims that you have tested anything.'
].join(' ');

async function generatePrompt({ apiKey, generatorModel, targetModel, request }) {
  if (!apiKey) {
    const error = new Error('Gemini API key is not configured.');
    error.code = 'MISSING_API_KEY';
    throw error;
  }
  const model = (await discoverModels()).find(item => item.id === targetModel) || MODEL_BY_ID.get(targetModel);
  if (!model) {
    const error = new Error('The selected target model is not supported.');
    error.code = 'INVALID_MODEL';
    throw error;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(generatorModel)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{
        role: 'user',
        parts: [{ text:
          `Target provider: ${model.provider}\nTarget model: ${model.name}\nTarget model ID: ${model.id}\n\nUser's request:\n${request}`
        }]
      }],
      generationConfig: { temperature: 0.55, maxOutputTokens: 8192 }
    }),
    signal: AbortSignal.timeout(60000)
  });

  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('Gemini returned an unreadable response.'); }

  if (!response.ok) {
    const status = response.status;
    const error = new Error(
      status === 429 ? 'Gemini is rate-limiting requests. Please try again shortly.' :
      status === 401 || status === 403 ? 'Gemini rejected the configured API key.' :
      status >= 500 ? 'Gemini is temporarily unavailable. Please try again.' :
      'Gemini could not generate the prompt.'
    );
    error.status = status;
    throw error;
  }

  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map(part => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty prompt. Please try again.');
  return { text, model };
}

module.exports = { MODELS, MODEL_BY_ID, generatePrompt, discoverModels };
