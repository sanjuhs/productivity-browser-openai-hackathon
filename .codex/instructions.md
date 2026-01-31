# Codex Instructions - Productivity Browser Assistant

## Package Managers (CRITICAL)

This project enforces specific package managers:

| Stack | Manager | Install | Add Package | Run |
|-------|---------|---------|-------------|-----|
| Python | `uv` | `uv sync` | `uv add <pkg>` | `uv run <cmd>` |
| Node.js | `pnpm` | `pnpm install` | `pnpm add <pkg>` | `pnpm <script>` |

### Forbidden Commands
- ❌ `pip install`, `pip3 install`, `python -m pip`
- ❌ `npm install`, `npm add`, `yarn add`

### Correct Commands
- ✅ `uv add requests` (Python)
- ✅ `uv run python script.py` (Python)
- ✅ `pnpm add lodash` (Node)
- ✅ `pnpm dev` (Node)

## Directory Structure

- `/backend` - Python FastAPI server (use `uv`)
- `/` (root) - Next.js frontend (use `pnpm`)
- `/.env` - Environment variables (OPENAI_API_KEY)

## Running the Project

Backend:
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

Frontend:
```bash
pnpm dev
```

## Tech Stack

- Frontend: Next.js 16, React 19, Tailwind CSS 4, ShadcnUI
- Backend: Python 3.12, FastAPI, RapidOCR, OpenAI SDK
- Database: SQLite

## Key Files

- `backend/main.py` - FastAPI server with OCR + Vision analysis
- `app/page.tsx` - Main React UI
- `backend/productivity.db` - SQLite analysis history
