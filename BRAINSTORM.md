# Productivity Browser Assistant - Brainstorm

## Vision
A multi-agent productivity system that monitors your screen in real-time, assesses your focus, and actively intervenes with voice alerts when you get distracted.

## Architecture

### Multi-Agent System
Three specialized agents work together:

1. **Observer Agent (30s interval)**
   - Captures screen via WebRTC
   - Uses GPT-5-mini (vision) to describe what's on screen
   - Stores factual observations (no inference)

2. **Compaction Agent (30min interval)**
   - Summarizes all observations from past 30 minutes
   - Resets strike count if ≤3 strikes (good behavior)
   - Provides condensed context for Manager

3. **Manager Agent (~2min random interval)**
   - Reads recent observations + task list
   - Decides if user is productive (GPT-5.2 reasoning)
   - Triggers interjections when distracted
   - Manages strike count (1-3)

### Frontend (Next.js + ShadcnUI)
- **Screen Capture**: WebRTC `getDisplayMedia()` API
- **Camera Feed**: `getUserMedia()` for optional webcam PiP
- **Interjection Modal**: TTS playback + voice input + force redirect
- **Agent Status**: Real-time observer/manager status display
- **Local Mode**: macOS window focus control via backend

### Backend (Python + FastAPI)
- **GPT-5-mini (vision)**: Screen observation and analysis
- **GPT-5.2**: Manager decisions (reasoning)
- **GPT-5-mini (text)**: Brain dump task extraction + compaction summaries
- **GPT-4o-mini**: Voice transcript task assessment
- **TTS-1**: Text-to-speech for interjection voice alerts
- **Whisper-1**: Speech-to-text for developer voice responses
- **SQLite**: Persistent storage of all agent data
- **AppleScript**: macOS window focus control (Local Mode)

## Multi-Agent Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                       OBSERVER AGENT (every 30s)                    │
├─────────────────────────────────────────────────────────────────────┤
│  [Screen Capture] → [Frame] → POST /api/observe                     │
│                                      ↓                              │
│                            ┌─────────────────┐                      │
│                            │  GPT-5-mini     │                      │
│                            │ "What's on screen?"                    │
│                            └────────┬────────┘                      │
│                                     ↓                               │
│                      ┌──────────────────────────┐                   │
│                      │   Store: observations    │                   │
│                      │ (app, window, description)                   │
│                      └──────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     COMPACTION AGENT (every 30min)                  │
├─────────────────────────────────────────────────────────────────────┤
│  POST /api/compact                                                  │
│        ↓                                                            │
│  ┌─────────────────┐    ┌────────────────────────┐                  │
│  │ Read last 30min │ →  │    GPT-5-mini          │                  │
│  │  observations   │    │ "Summarize activity"   │                  │
│  └─────────────────┘    └───────────┬────────────┘                  │
│                                     ↓                               │
│                      ┌──────────────────────────┐                   │
│                      │   Store: compactions     │                   │
│                      │ + Reset strikes if ≤3    │                   │
│                      └──────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
                                     ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      MANAGER AGENT (every ~2min)                    │
├─────────────────────────────────────────────────────────────────────┤
│  POST /api/manager                                                  │
│        ↓                                                            │
│  ┌─────────────────────────────────────────┐                        │
│  │ Input: Tasks + Recent observations      │                        │
│  │        + 30-min summary (if available)  │                        │
│  └───────────────────┬─────────────────────┘                        │
│                      ↓                                              │
│            ┌─────────────────┐                                      │
│            │   GPT-5.2       │                                      │
│            │ "Is productive? │                                      │
│            │  Interjection?" │                                      │
│            └────────┬────────┘                                      │
│                     ↓                                               │
│        ┌────────────────────────┐                                   │
│        │ Interjection needed?   │                                   │
│        └───────────┬────────────┘                                   │
│              Yes   │   No                                           │
│               ↓    └──→ [Done]                                      │
│    ┌──────────────────────┐                                         │
│    │ Increment strike     │                                         │
│    │ (capped at 3)        │                                         │
│    │ Save pending interj. │                                         │
│    └──────────┬───────────┘                                         │
└───────────────┼─────────────────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      INTERJECTION FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                                                    │
│  │ Strike 1-2  │                                                    │
│  └──────┬──────┘                                                    │
│         ↓                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   TTS Alert     │ →  │  Voice Input    │ →  │ Task Assessment │  │
│  │ (gentle/firm)   │    │  "What tasks    │    │ (mark complete) │  │
│  │                 │    │   completed?"   │    │                 │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘  │
│                                                                     │
│  ┌─────────────┐                                                    │
│  │ Strike 3+   │                                                    │
│  └──────┬──────┘                                                    │
│         ↓                                                           │
│  ┌─────────────────┐    ┌─────────────────┐                         │
│  │   TTS Alert     │ →  │ Force Redirect  │ (no voice input)        │
│  │ "Enough is      │    │ to productivity │                         │
│  │  enough..."     │    │ app (Cursor)    │                         │
│  └─────────────────┘    └─────────────────┘                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Database Schema (SQLite)

```sql
-- User tasks
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0
);

-- Observer agent observations
CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    app_name TEXT,
    window_title TEXT,
    description TEXT
);

-- 30-minute compaction summaries
CREATE TABLE compactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    summary TEXT,
    observations_count INTEGER,
    apps_seen TEXT
);

-- Manager agent decisions
CREATE TABLE manager_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    is_productive INTEGER,
    reasoning TEXT,
    interjection INTEGER,
    interjection_message TEXT,
    tasks_updated TEXT,
    elapsed_ms REAL
);

-- Pending interjections for frontend
CREATE TABLE pending_interjections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL,
    acknowledged INTEGER DEFAULT 0
);

-- Focus strike tracking (singleton row)
CREATE TABLE focus_strikes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    strike_count INTEGER DEFAULT 0,
    window_start TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

## Key Features

### Phase 1 - Foundation ✅
- [x] Project setup (Next.js + Python backend)
- [x] Screenshot analysis with GPT-5-mini (vision)
- [x] Basic UI with daily input + focus mode

### Phase 2 - Multi-Agent System ✅
- [x] Observer Agent (30s) - screen observation
- [x] Compaction Agent (30min) - activity summarization
- [x] Manager Agent (~2min) - productivity assessment
- [x] SQLite storage for all agent data

### Phase 3 - Interjection System ✅
- [x] TTS voice alerts (OpenAI TTS-1)
- [x] Voice input for progress reports (Whisper)
- [x] Strike escalation (1-3) with tone changes
- [x] Force redirect at strike 3+ (no voice input)
- [x] macOS window focus control (AppleScript)
- [x] Strike reset on good behavior (≤3 in 30min)

### Phase 4 - Future Improvements
- [ ] Productivity scoring over time
- [ ] Daily/weekly reports from stored data
- [ ] Browser extension for deeper app detection
- [ ] Animated character companion
- [ ] Cross-platform window focus (Windows/Linux)

## Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, ShadcnUI |
| Backend | Python 3.12, FastAPI, OpenAI SDK |
| Database | SQLite (local) |
| AI Models | GPT-5.2 (reasoning), GPT-5-mini (vision + text), GPT-4o-mini (task parsing), TTS-1, Whisper-1 |
| APIs | WebRTC (screen), Web Audio (alerts), MediaRecorder (voice) |
| OS Integration | AppleScript (macOS window focus) |

## Performance Metrics
- Observer Agent: ~15-25s per observation (GPT-5-mini vision)
- Manager Agent: ~2-4s per decision (GPT-5.2)
- TTS Generation: ~1-2s for MP3
- Whisper Transcription: ~1-2s for short clips
- Agent Intervals: Observer 30s, Manager ~2min, Compaction 30min

## Privacy & Security
- Screen capture requires explicit user permission
- Microphone access requires explicit permission
- All data stored locally in SQLite
- Screenshots not persisted, only text descriptions
- Voice recordings not persisted, only transcripts

## API Endpoints

### Core
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks from text |
| GET | `/api/tasks` | Get all tasks |
| POST | `/api/tasks` | Add a task |

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
| GET | `/api/interjection` | Check pending |
| POST | `/api/interjection/acknowledge` | Acknowledge |
| POST | `/api/interjection-speech` | Generate TTS |
| POST | `/api/non-compliance-speech` | Stern TTS |
| POST | `/api/transcribe` | Whisper STT |
| POST | `/api/assess-task-completion` | Voice assessment |
| GET | `/api/strike-status` | Strike count |

### Local Mode
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/focus-browser` | Focus browser |
| POST | `/api/focus-productive-app` | Focus Cursor/VS Code |

## Strike System

| Strike | TTS Tone | Voice Input | Action |
|--------|----------|-------------|--------|
| 1 | Gentle | ✅ Allowed | Ask for progress |
| 2 | Firm | ✅ Allowed | Ask for progress |
| 3+ | Stern | ❌ Disabled | Force redirect only |

Strike reset: If ≤3 strikes in a 30-min window, compaction agent resets to 0.

## Open Questions
1. Cross-platform window focus (Windows/Linux)?
2. Browser extension for deeper app/tab detection?
3. Integration with calendar for meeting-aware focus mode?
4. Gamification: rewards for streaks of productive behavior?
