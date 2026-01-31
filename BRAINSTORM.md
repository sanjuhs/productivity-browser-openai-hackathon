# Productivity Browser Assistant - Brainstorm

## Vision
A Google Meet-like browser experience that captures your screen in real-time and uses AI to provide intelligent productivity assistance based on what you're working on.

## Architecture

### Frontend (Next.js + ShadcnUI)
- **Screen Capture**: WebRTC `getDisplayMedia()` API for real-time screen capture
- **Camera Feed**: `getUserMedia()` for optional webcam PiP
- **Auto-Analysis**: Configurable interval (default 1 minute) for continuous monitoring
- **UI Components**:
  - Daily input text box (brain dump / task entry)
  - Character companion with focus state indicator
  - Focus mode task tracker with auto-completion

### Backend (Python + FastAPI)
- **RapidOCR**: First-pass text extraction from screenshots (fast, local)
- **GPT-4o Vision**: Fallback for low-confidence OCR or complex analysis
- **GPT-4o-mini**: Text analysis for brain dump → task extraction
- **SQLite**: Persistent storage of analysis history

## Analysis Pipeline

```
[Screen Capture] → [Frame Extraction] → [HTTP POST]
                                              ↓
                                    ┌─────────────────┐
                                    │   RapidOCR      │
                                    │ (text extract)  │
                                    └────────┬────────┘
                                             ↓
                              ┌──────────────────────────┐
                              │ Text length > 50 chars?  │
                              └──────────┬───────────────┘
                                   ╱            ╲
                                 Yes             No
                                  ↓               ↓
                          ┌───────────────┐ ┌───────────────┐
                          │ GPT-4o-mini   │ │ GPT-4o Vision │
                          │ (text→focus)  │ │ (image→focus) │
                          └───────┬───────┘ └───────┬───────┘
                                  ↓                 ↓
                              ┌──────────────────────┐
                              │ confidence == "low"? │
                              └──────────┬───────────┘
                                   ╱           ╲
                                 Yes            No
                                  ↓              ↓
                          ┌───────────────┐     │
                          │ GPT-4o Vision │     │
                          │   (fallback)  │     │
                          └───────┬───────┘     │
                                  └──────┬──────┘
                                         ↓
                              ┌─────────────────────┐
                              │  SQLite Storage     │
                              │  (timestamp, data)  │
                              └─────────────────────┘
                                         ↓
                              ┌─────────────────────┐
                              │  Response to FE     │
                              │  - analysis         │
                              │  - thought          │
                              │  - is_focused       │
                              │  - tasks_to_add     │
                              │  - tasks_to_complete│
                              └─────────────────────┘
```

## Database Schema (SQLite)

```sql
CREATE TABLE analysis_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    ocr_text TEXT,
    analysis TEXT,
    thought TEXT,
    is_focused INTEGER,
    tasks_suggested TEXT,      -- JSON array
    tasks_completed TEXT,      -- JSON array
    method TEXT,               -- "ocr" or "vision"
    elapsed_ms REAL
);
```

## Key Features

### Phase 1 - Foundation ✅
- [x] Project setup (Next.js + Python backend)
- [x] Screenshot analysis with GPT-4o
- [x] Basic UI with daily input + character + focus mode

### Phase 2 - Smart Analysis ✅
- [x] RapidOCR integration for fast text extraction
- [x] Two-tier analysis (OCR first, vision fallback)
- [x] SQLite storage for analysis history
- [x] Auto-analyze every minute option
- [x] Task auto-completion based on screen analysis

### Phase 3 - Intelligence (Next)
- [ ] Productivity scoring over time
- [ ] Daily/weekly reports from stored data
- [ ] Distraction detection and alerts
- [ ] Smart break reminders

### Phase 4 - Character Companion
- [ ] Animated character responses
- [ ] Voice feedback (TTS)
- [ ] Personality tuning

## Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, ShadcnUI |
| Backend | Python 3.12, FastAPI, OpenAI SDK, RapidOCR |
| Database | SQLite (local), aiosqlite |
| APIs | GPT-4o (vision), GPT-4o-mini (text), WebRTC |
| Infra | Local dev → Vercel (FE) + Railway/Fly (BE) |

## Performance Metrics
- RapidOCR: ~200-500ms per frame
- GPT-4o-mini (text): ~1-2s response
- GPT-4o vision: ~3-8s response
- Auto-analyze interval: 60 seconds (configurable)

## Privacy & Security
- Screen capture requires explicit user permission
- OCR runs locally (no cloud for text extraction)
- Analysis data stored locally in SQLite
- Screenshots not persisted, only analysis results

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks from text |
| POST | `/api/analyze-screen` | Analyze screenshot (OCR + AI) |
| GET | `/api/history` | Get analysis history |
| DELETE | `/api/history` | Clear history |

## Open Questions
1. Optimal auto-analyze interval for balance between insight and cost?
2. How aggressive should distraction alerts be?
3. Should we add browser extension for deeper app detection?
4. Integration with calendar for meeting-aware focus mode?
