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
│   ├── page.tsx            # Main UI + interjection modal
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Tailwind styles
├── backend/                # Python FastAPI backend
│   ├── main.py             # API server + all agents
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

## Multi-Agent Architecture

Three agents work together to monitor productivity:

1. **Observer Agent (30s)** - Captures screen via GPT-4o Vision, stores observations
2. **Compaction Agent (30min)** - Summarizes observations, resets strikes if ≤3
3. **Manager Agent (~2min)** - Assesses productivity, triggers interjections

## Interjection System

- **Strike 1-2**: TTS alert → Voice input → Task assessment
- **Strike 3+**: TTS alert → Force redirect (no voice input)
- Strikes reset if ≤3 in 30-min window (by compaction agent)

## API Endpoints

### Core
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks from text |
| GET | `/api/tasks` | Get all tasks |
| POST | `/api/tasks` | Add a task |
| PUT | `/api/tasks/{id}` | Toggle task completion |

### Multi-Agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/observe` | Observer agent |
| POST | `/api/compact` | Compaction agent |
| POST | `/api/manager` | Manager agent |
| GET | `/api/next-manager-interval` | Random interval (115-125s) |

### Interjection
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/interjection` | Check pending interjections |
| POST | `/api/interjection/acknowledge` | Acknowledge interjection |
| POST | `/api/interjection-speech` | Generate TTS (MP3) |
| POST | `/api/non-compliance-speech` | Stern TTS for non-compliance |
| POST | `/api/transcribe` | Whisper STT |
| POST | `/api/assess-task-completion` | Voice assessment |
| GET | `/api/strike-status` | Get strike count |

### Local Mode (macOS)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/focus-browser` | Focus browser window |
| POST | `/api/focus-productive-app` | Focus Cursor/VS Code |

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, ShadcnUI
- **Backend**: Python 3.12, FastAPI, OpenAI SDK
- **Database**: SQLite (productivity.db)
- **AI Models**: GPT-4o (vision), GPT-4o-mini (text), TTS-1, Whisper-1

## Database Tables

- `tasks` - User tasks (id, text, done)
- `observations` - Observer outputs (timestamp, app_name, window_title, description)
- `compactions` - 30-min summaries (timestamp, summary, observations_count, apps_seen)
- `manager_decisions` - Manager outputs (is_productive, reasoning, interjection, ...)
- `pending_interjections` - Awaiting frontend acknowledgment
- `focus_strikes` - Strike count tracking (strike_count, window_start)
