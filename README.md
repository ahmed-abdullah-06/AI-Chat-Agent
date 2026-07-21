# ARIA — Adaptive Real-life Intelligence Agent

ARIA is an AI chat agent app with a web frontend and backend, supporting multiple AI providers (Gemini, OpenAI, Anthropic, OpenRouter).

## Project Structure
AI-Chat-Agent/
├── src/ # Vite-based frontend (main app)
├── dist/ # Production build output
├── ARIA/
│ ├── frontend/ # ARIA UI (HTML/CSS/JS)
│ └── backend/ # Python FastAPI backend
├── Agent app 3f/ # Node/Express variant of the agent app
├── .env.example # Template for root environment variables
└── package.json

## Setup

### Frontend / Root app (Node + Vite)
```bash
npm install
cp .env.example .env
npm run dev
```

### ARIA Backend (Python FastAPI)
```bash
cd ARIA/backend
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload
```

### Agent app 3f (Node + Express)
```bash
cd "Agent app 3f"
npm install
node server.js
```

## Environment Variables

Never commit real `.env` files — only `.env.example` templates with placeholder values are pushed to GitHub.
