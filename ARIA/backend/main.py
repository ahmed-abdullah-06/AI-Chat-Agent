# ═══════════════════════════════════════════
#  ARIA — backend/main.py
#  FastAPI + OpenRouter
# ═══════════════════════════════════════════

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import httpx
import os
import json
from dotenv import load_dotenv

load_dotenv()

# ── APP ──────────────────────────────────────
app = FastAPI(
    title="ARIA Backend",
    description="Adaptive Real-life Intelligence Agent — Powered by OpenRouter",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── CONFIG ───────────────────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE    = "https://openrouter.ai/api/v1"
DEFAULT_MODEL      = os.getenv("DEFAULT_MODEL", "anthropic/claude-3.5-sonnet")

# ── SYSTEM PROMPTS ───────────────────────────
SYSTEM_PROMPTS = {
    "think": "You are ARIA in THINK MODE — a world-class strategic thinker and life advisor. Break down the user's problem using first principles, mental models, frameworks, and decisive recommendations. Be sharp, insightful, and practical.",
    "research": "You are ARIA in RESEARCH MODE — a world-class researcher and analyst. Provide well-structured, accurate, insightful answers with key facts, context, nuance, and depth. Cite what you know.",
    "create": "You are ARIA in CREATE MODE — a brilliant creative mind: copywriter, storyteller, idea generator, brand strategist. Help the user create compelling, original, memorable content. Be vivid, punchy, and imaginative.",
    "execute": "You are ARIA in EXECUTE MODE — a master of planning and execution. Turn goals into concrete action plans with steps, timelines, and priorities. Be ruthlessly practical. No fluff.",
}

STYLE_SUFFIX = {
    "concise":  " Keep your response under 120 words. Be direct.",
    "balanced": " Keep your response under 220 words. Balance depth with brevity.",
    "detailed": " Be thorough and detailed, up to 400 words.",
}

# ── SCHEMAS ──────────────────────────────────
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    mode: str = "think"
    style: str = "balanced"
    model: Optional[str] = None

class ChatStreamRequest(BaseModel):
    messages: List[Message]
    mode: str = "think"
    style: str = "balanced"
    model: Optional[str] = None

class NewsRequest(BaseModel):
    count: int = 10

# ── HEALTH ───────────────────────────────────
@app.get("/")
async def root():
    return {"status": "running", "app": "ARIA Backend", "version": "1.0.0", "model": DEFAULT_MODEL}

@app.get("/health")
async def health():
    return {"status": "ok"}

# ── MODELS LIST ──────────────────────────────
@app.get("/models")
async def get_models():
    return {"models": [
        {"id": "anthropic/claude-3.5-sonnet",      "name": "Claude 3.5 Sonnet",  "provider": "Anthropic", "recommended": True},
        {"id": "anthropic/claude-3-haiku",          "name": "Claude 3 Haiku",     "provider": "Anthropic", "fast": True},
        {"id": "openai/gpt-4o",                     "name": "GPT-4o",             "provider": "OpenAI",    "recommended": True},
        {"id": "openai/gpt-4o-mini",                "name": "GPT-4o Mini",        "provider": "OpenAI",    "fast": True},
        {"id": "google/gemini-pro-1.5",             "name": "Gemini Pro 1.5",     "provider": "Google"},
        {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B",     "provider": "Meta",      "free": True},
        {"id": "mistralai/mistral-large",           "name": "Mistral Large",      "provider": "Mistral"},
        {"id": "deepseek/deepseek-chat",            "name": "DeepSeek Chat",      "provider": "DeepSeek",  "fast": True},
    ]}

# ── CHAT ─────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not set in .env")

    mode   = req.mode  if req.mode  in SYSTEM_PROMPTS else "think"
    style  = req.style if req.style in STYLE_SUFFIX   else "balanced"
    model  = req.model or DEFAULT_MODEL
    system = SYSTEM_PROMPTS[mode] + STYLE_SUFFIX[style]

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            *[{"role": m.role, "content": m.content} for m in req.messages[-12:]]
        ],
        "max_tokens": 1024,
        "temperature": 0.7,
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://aria-app.local",
        "X-Title":       "ARIA Agent",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{OPENROUTER_BASE}/chat/completions", json=payload, headers=headers)

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data  = resp.json()
    reply = data["choices"][0]["message"]["content"]
    return {"reply": reply, "model": data.get("model", model), "usage": data.get("usage", {})}

# ── CHAT STREAM ──────────────────────────────
@app.post("/chat/stream")
async def chat_stream(req: ChatStreamRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not set in .env")

    mode   = req.mode  if req.mode  in SYSTEM_PROMPTS else "think"
    style  = req.style if req.style in STYLE_SUFFIX   else "balanced"
    model  = req.model or DEFAULT_MODEL
    system = SYSTEM_PROMPTS[mode] + STYLE_SUFFIX[style]

    payload = {
        "model": model,
        "stream": True,
        "messages": [
            {"role": "system", "content": system},
            *[{"role": m.role, "content": m.content} for m in req.messages[-12:]]
        ],
        "max_tokens": 1024,
        "temperature": 0.7,
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://aria-app.local",
        "X-Title":       "ARIA Agent",
    }

    async def stream_gen():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", f"{OPENROUTER_BASE}/chat/completions", json=payload, headers=headers) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        chunk = line[6:]
                        if chunk.strip() == "[DONE]":
                            yield "data: [DONE]\n\n"
                            break
                        try:
                            obj   = json.loads(chunk)
                            delta = obj["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield f"data: {json.dumps({'text': delta})}\n\n"
                        except Exception:
                            continue

    return StreamingResponse(stream_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── WORLD NEWS ───────────────────────────────
@app.post("/news")
async def get_news(req: NewsRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not set in .env")

    prompt = (
        f'Generate {req.count} realistic diverse world news headlines for today (2026). '
        'Return ONLY a JSON array, no markdown. '
        'Each: {"title":string,"summary":string max 28 words,"category":"Tech"|"World"|"Science"|"Business","urgency":"high"|"medium"|"low"}'
    )

    payload = {
        "model": DEFAULT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1200,
        "temperature": 0.8,
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://aria-app.local",
        "X-Title":       "ARIA Agent",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{OPENROUTER_BASE}/chat/completions", json=payload, headers=headers)

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    raw = resp.json()["choices"][0]["message"]["content"]
    raw = raw.replace("```json", "").replace("```", "").strip()

    try:
        news = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse news JSON")

    return {"news": news}

# ── RUN ──────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)