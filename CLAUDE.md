# CLAUDE.md - Productivity Browser Assistant

This file provides guidance for Claude (Anthropic) when working with this codebase.

## Package Managers (MANDATORY)

**You MUST use these specific package managers:**

### Python → `uv`
```bash
# Install dependencies
uv sync

# Add a package
uv add <package-name>

# Run Python scripts
uv run python script.py

# Run FastAPI server
uv run uvicorn main:app --reload --port 8000
```

### Node.js → `pnpm`
```bash
# Install dependencies
pnpm install

# Add a package
pnpm add <package-name>

# Run dev server
pnpm dev
```

### DO NOT USE
- ❌ `pip`, `pip3`, `pip install`
- ❌ `npm`, `yarn`

## Project Layout

```
productivity-browser-openai-hackathon/
├── app/                    # Next.js app router pages
│   ├── page.tsx            # Main UI component
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Tailwind styles
├── backend/                # Python FastAPI backend
│   ├── main.py             # API server
│   ├── pyproject.toml      # Python dependencies (uv)
│   ├── .venv/              # Virtual environment
│   └── productivity.db     # SQLite database
├── components/ui/          # ShadcnUI components
├── .env                    # OPENAI_API_KEY
├── package.json            # Node dependencies (pnpm)
└── pnpm-lock.yaml
```

## Environment Variables

Create `.env` in project root:
```
OPENAI_API_KEY=sk-...
```

## Running the Application

**Terminal 1 (Backend):**
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

**Terminal 2 (Frontend):**
```bash
pnpm dev
```

Open http://localhost:3000

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks from text |
| POST | `/api/analyze-screen` | Analyze screenshot (OCR → Vision) |
| GET | `/api/history` | Get analysis history |
| DELETE | `/api/history` | Clear history |

## Analysis Pipeline

1. Screenshot captured in browser
2. Sent to `/api/analyze-screen`
3. RapidOCR extracts text (local, fast)
4. If text > 50 chars → GPT-4o-mini analyzes
5. If low confidence → GPT-4o Vision fallback
6. Result stored in SQLite
7. Response updates UI

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, ShadcnUI
- **Backend**: Python 3.12, FastAPI, RapidOCR, OpenAI
- **Database**: SQLite (productivity.db)
