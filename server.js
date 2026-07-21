// Main Express server for the AI Chat Agent
// Handles API routes and serves the frontend build

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve production build files
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Fallback Mock News Items (when API keys are missing or API fails)
const mockNewsItems = [
  { title: "Gemini 2.5 Pro released with 2M token context window", summary: "Google rolls out its latest model featuring native multimodal capabilities and ultra-long reasoning capacity.", category: "Tech", urgency: "high" },
  { title: "Global Fusion Energy consortium reports record energy yield", summary: "Scientists achieve sustained high-efficiency plasma confinement for over 5 minutes in latest tokamak test.", category: "Science", urgency: "high" },
  { title: "Major central banks coordinate rate adjustments amid inflation cooling", summary: "Economic policy shift aims to support steady growth across US, EU and Asian markets.", category: "Business", urgency: "medium" },
  { title: "Deep Sea Exploration project discovers 40 new marine species", summary: "Oceanographers in the Mariana Trench capture footage of previously unclassified marine life forms.", category: "Science", urgency: "low" },
  { title: "Autonomous logistics network goes live in three European cities", summary: "Self-driving electric pods begin commercial delivery runs for freight and postal services.", category: "Tech", urgency: "medium" },
  { title: "Global Reforestation pact achieves milestone of 100M trees planted", summary: "Multinational effort hits key goal three months ahead of schedule, restoring critical habitats.", category: "World", urgency: "low" },
  { title: "SpaceX successfully lands Starship booster on orbital launch mount", summary: "Milestone achievement brings fully reusable rapid rocket deployment closer to reality.", category: "Science", urgency: "high" },
  { title: "Electric vehicle solid-state battery production starts scaling", summary: "New chemistry promises 800-mile range and sub-10-minute recharge cycles starting next year.", category: "Business", urgency: "medium" },
  { title: "Quantum key distribution link secured between London and New York", summary: "Financial institutions deploy first commercially viable transatlantic quantum-secure data channel.", category: "Tech", urgency: "high" },
  { title: "International Treaty signed for ethical deployment of robotic systems", summary: "Thirty nations align on binding guidelines restricting offensive capabilities in autonomous hardware.", category: "World", urgency: "medium" },
  { title: "Semiconductor manufacturer announces $40B fabrication plant expansion", summary: "New facility aims to produce next-generation 1.4nm processing units to combat AI chip shortages.", category: "Business", urgency: "medium" },
  { title: "Biotech firm initiates human trials for universal influenza vaccine", summary: "mRNA-based therapy targets core genetic structures common across all major seasonal flu strains.", category: "Science", urgency: "medium" }
];

// Helper to get API Key (checks request header first, then fallback to server .env)
function getApiKey(req, provider) {
  const headerKey = req.headers[`x-api-key-${provider}`] || req.headers[`x-api-key`];
  if (headerKey) return headerKey;

  switch (provider) {
    case 'gemini': return process.env.GEMINI_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    default: return null;
  }
}

// REST Proxy Endpoint for Chat
app.post('/api/chat', async (req, res) => {
  const { provider, model, messages, system } = req.body;
  const apiKey = getApiKey(req, provider);

  if (!apiKey) {
    return res.status(401).json({ error: `API Key for ${provider} is missing. Please configure it in Settings.` });
  }

  try {
    if (provider === 'gemini') {
      // Gemini API call (v1beta)
      // Gemini model structure uses model names like 'gemini-2.5-flash' or 'gemini-2.5-pro'
      const geminiModel = model || 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

      // Convert messages to Gemini format: roles are 'user' and 'model'
      const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const body = {
        contents: contents
      };

      if (system) {
        body.systemInstruction = {
          parts: [{ text: system }]
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
      
      return res.json({ reply });

    } else if (provider === 'openai') {
      // OpenAI API call
      const openAiModel = model || 'gpt-4o-mini';
      const url = 'https://api.openai.com/v1/chat/completions';

      const payloadMessages = [];
      if (system) {
        payloadMessages.push({ role: 'system', content: system });
      }
      messages.forEach(msg => {
        payloadMessages.push({ role: msg.role, content: msg.content });
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: openAiModel,
          messages: payloadMessages,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || 'No response generated.';
      
      return res.json({ reply });

    } else if (provider === 'anthropic') {
      // Anthropic API call
      const anthropicModel = model || 'claude-3-5-sonnet-latest';
      const url = 'https://api.anthropic.com/v1/messages';

      const body = {
        model: anthropicModel,
        max_tokens: 1000,
        messages: messages.map(msg => ({ role: msg.role, content: msg.content }))
      };

      if (system) {
        body.system = system;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API Error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const reply = data.content?.[0]?.text || 'No response generated.';
      
      return res.json({ reply });

    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
  } catch (error) {
    console.error('Error in /api/chat proxy:', error);
    res.status(500).json({ error: error.message || 'An error occurred during processing.' });
  }
});

// REST Endpoint for News Generation
app.post('/api/news', async (req, res) => {
  const { provider, model } = req.body;
  const apiKey = getApiKey(req, provider);

  // If no API Key is available, fail gracefully and send fallback mock news items
  if (!apiKey) {
    console.log(`No API Key configured for ${provider}. Serving mock news feed.`);
    return res.json({ news: mockNewsItems, source: 'fallback' });
  }

  const prompt = `Return ONLY a valid JSON array with NO markdown fences, no preamble, no trailing text. Generate exactly 12 realistic, diverse, current world news items (May 2026). Each object must have exactly these keys: title (string, max 12 words), summary (string, max 25 words), category (exactly one of: Tech, World, Science, Business), urgency (exactly one of: high, medium, low). Make them feel real and current.`;

  try {
    if (provider === 'gemini') {
      const geminiModel = model || 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);
      const data = await response.json();
      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      rawText = cleanJsonResponse(rawText);
      const news = JSON.parse(rawText);
      return res.json({ news, source: 'gemini' });

    } else if (provider === 'openai') {
      const openAiModel = model || 'gpt-4o-mini';
      const url = 'https://api.openai.com/v1/chat/completions';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: openAiModel,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: "json_object" } // Enforce JSON if available
        })
      });

      if (!response.ok) throw new Error(`OpenAI API Error: ${response.status}`);
      const data = await response.json();
      let rawText = data.choices?.[0]?.message?.content || '[]';
      
      // OpenAI JSON response might be wrapped in an object, ensure it's an array
      let news = JSON.parse(rawText);
      if (!Array.isArray(news) && news.news) news = news.news;
      if (!Array.isArray(news) && news.items) news = news.items;
      if (!Array.isArray(news)) {
        // Find any array key
        const key = Object.keys(news).find(k => Array.isArray(news[k]));
        if (key) news = news[key];
        else throw new Error("Could not parse array from OpenAI JSON");
      }
      
      return res.json({ news, source: 'openai' });

    } else if (provider === 'anthropic') {
      const anthropicModel = model || 'claude-3-5-sonnet-latest';
      const url = 'https://api.anthropic.com/v1/messages';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`Anthropic API Error: ${response.status}`);
      const data = await response.json();
      let rawText = data.content?.[0]?.text || '[]';
      rawText = cleanJsonResponse(rawText);
      const news = JSON.parse(rawText);
      return res.json({ news, source: 'anthropic' });
    }
  } catch (error) {
    console.error('Failed to generate news dynamically. Serving mock data.', error);
    return res.json({ news: mockNewsItems, source: 'fallback-after-error', error: error.message });
  }
});

// Serve frontend in production (spa fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Vite Dev server running? Build with "npm run build" to serve statically.');
    }
  });
});

// JSON parsing helper to strip markdown code blocks
function cleanJsonResponse(text) {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(json)?/g, '').replace(/```$/g, '').trim();
  }
  return clean;
}

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` ARIA Proxy Server running on http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
