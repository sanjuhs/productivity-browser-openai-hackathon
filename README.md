# Productivity Browser Assistant

AI-powered productivity companion that monitors your screen and helps you stay focused on your tasks.

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

- **Screen Capture** - Share your screen for real-time monitoring
- **Camera Feed** - Optional webcam for picture-in-picture
- **Smart Analysis** - Uses RapidOCR + GPT-4o to understand what you're working on
- **Auto-Monitoring** - Automatic analysis every minute (toggleable)
- **Focus Tracking** - Companion indicates if you're focused or distracted
- **Task Management** - Brain dump extraction + auto task completion
- **Analysis History** - SQLite storage of all analyses

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
- **Backend**: Python 3.12, FastAPI, RapidOCR, OpenAI
- **Database**: SQLite
- **AI Models**: GPT-4o (vision), GPT-4o-mini (text)

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks from text |
| POST | `/api/analyze-screen` | Analyze screenshot |
| GET | `/api/history?limit=50` | Get analysis history |
| DELETE | `/api/history` | Clear history |

## Analysis Pipeline

1. **RapidOCR** extracts text from screenshot (fast, local)
2. If enough text (>50 chars), **GPT-4o-mini** analyzes productivity
3. If low confidence or not enough text, **GPT-4o Vision** analyzes image
4. Results stored in **SQLite** with timestamp
5. Response updates companion state + can add/complete tasks

## Project Structure

```
├── app/
│   ├── page.tsx          # Main UI
│   ├── layout.tsx        # App layout
│   └── globals.css       # Tailwind styles
├── backend/
│   ├── main.py           # FastAPI server
│   ├── productivity.db   # SQLite database
│   └── pyproject.toml    # Python deps
├── components/
│   └── ui/               # ShadcnUI components
├── .env                  # API keys
└── BRAINSTORM.md         # Architecture docs
```

## License

MIT
