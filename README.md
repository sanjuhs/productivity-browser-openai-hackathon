# Productivity Browser Assistant

AI-powered multi-agent productivity companion that monitors your screen, tracks your focus, and actively intervenes when you get distracted.

## Development Rules

> **Important**: This project uses specific package managers. Please follow these rules:

| Language | Package Manager | Commands |
|----------|-----------------|----------|
| **Python** | `uv` | `uv add <pkg>`, `uv sync`, `uv run <cmd>` |
| **Node.js** | `pnpm` | `pnpm add <pkg>`, `pnpm install`, `pnpm dev` |

- **DO NOT** use `pip`, `pip3`, `npm`, or `yarn`
- Backend lives in `/backend` directory
- Frontend lives in root directory

## Features

### Core
- **Screen Capture** - Share your screen for real-time monitoring
- **Camera Feed** - Optional webcam for picture-in-picture
- **Task Management** - Brain dump extraction + auto task completion
- **Analysis History** - SQLite storage of all agent decisions

### Multi-Agent System
- **Observer Agent (30s)** - Captures and describes what's on screen
- **Compaction Agent (30min)** - Summarizes 30 minutes of observations
- **Manager Agent (~2min)** - Assesses productivity and triggers interjections

### Interjection System
- **TTS Voice Alerts** - OpenAI text-to-speech for focus reminders
- **Voice Input** - Report completed tasks via voice (Whisper STT)
- **Strike Escalation** - 3-strike system with escalating tone:
  - Strike 1: Gentle reminder, asks for progress
  - Strike 2: Firm reminder, asks for progress
  - Strike 3+: Stern redirect, no voice input allowed
- **Force Redirect** - Automatically switches you back to work (macOS)

### Local Mode (macOS)
- **Window Focus Control** - AppleScript-based window switching
- **Productivity App Detection** - Auto-switches to Cursor/VS Code

## Quick Start

### 1. Install dependencies

**Frontend:**
```bash
pnpm install
```

**Backend:**
```bash
cd backend
uv sync
```

### 2. Set up environment

Create `.env` in the root directory:
```
OPENAI_API_KEY=your-api-key-here
```

### 3. Run the app

**Terminal 1 - Backend:**
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

**Terminal 2 - Frontend:**
```bash
pnpm dev
```

Open http://localhost:3000

## Usage

1. **Brain Dump** - Type your thoughts → click "Extract Tasks" to get actionable items
2. **Screen Capture** - Click "Screen" → select window/screen to share
3. **Camera** - Click "Camera" to enable webcam PiP
4. **Analyze** - Click "Analyze" for instant analysis
5. **Auto Mode** - Click "Auto (1m)" to enable automatic analysis every minute

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, ShadcnUI
- **Backend**: Python 3.12, FastAPI, OpenAI SDK
- **Database**: SQLite
- **AI Models**: 
  - GPT-4o (vision analysis)
  - GPT-4o-mini (text analysis, task assessment)
  - TTS-1 (text-to-speech for interjections)
  - Whisper-1 (speech-to-text for voice responses)

## API Endpoints

### Core
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks from text |
| GET | `/api/tasks` | Get all tasks |
| POST | `/api/tasks` | Add a task |
| PUT | `/api/tasks/{id}` | Toggle task completion |
| DELETE | `/api/history` | Clear all history |

### Multi-Agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/observe` | Observer agent - describe screen |
| POST | `/api/compact` | Compaction agent - summarize 30min |
| POST | `/api/manager` | Manager agent - assess productivity |
| GET | `/api/next-manager-interval` | Get random manager interval |

### Interjection
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/interjection` | Check for pending interjections |
| POST | `/api/interjection/acknowledge` | Acknowledge interjection |
| POST | `/api/interjection-speech` | Generate TTS audio (MP3) |
| POST | `/api/non-compliance-speech` | Generate stern TTS for non-compliance |
| POST | `/api/transcribe` | Transcribe voice (Whisper) |
| POST | `/api/assess-task-completion` | Assess voice response for task completion |
| GET | `/api/strike-status` | Get current strike count |

### Local Mode (macOS)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/focus-browser` | Focus browser window |
| POST | `/api/focus-productive-app` | Focus Cursor/VS Code |

## Agent Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVER AGENT (30s)                     │
│  Screen capture → GPT-4o Vision → Store observation         │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   COMPACTION AGENT (30min)                  │
│  Summarize observations → Reset strike count if ≤3          │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    MANAGER AGENT (~2min)                    │
│  Recent observations + tasks → Productivity assessment      │
│  → Interjection decision → Strike count (1-3)               │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   INTERJECTION FLOW                         │
│  TTS Alert → Voice Input (strike 1-2) → Task Assessment     │
│  OR: TTS Alert → Force Redirect (strike 3+)                 │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
├── app/
│   ├── page.tsx          # Main UI + interjection modal
│   ├── layout.tsx        # App layout
│   └── globals.css       # Tailwind styles
├── backend/
│   ├── main.py           # FastAPI server + all agents
│   ├── productivity.db   # SQLite database
│   └── pyproject.toml    # Python deps (uv)
├── components/
│   └── ui/               # ShadcnUI components
├── .env                  # OPENAI_API_KEY
├── BRAINSTORM.md         # Architecture docs
└── CLAUDE.md             # AI assistant instructions
```

## Database Schema

```sql
-- Tasks
tasks (id, text, done)

-- Observer observations  
observations (id, timestamp, app_name, window_title, description)

-- 30-min compaction summaries
compactions (id, timestamp, summary, observations_count, apps_seen)

-- Manager decisions
manager_decisions (id, timestamp, is_productive, reasoning, interjection, ...)

-- Pending interjections
pending_interjections (id, timestamp, message, acknowledged)

-- Focus strike tracking
focus_strikes (id, strike_count, window_start, updated_at)
```

## License

MIT
