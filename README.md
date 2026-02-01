# 🎯 Productivity Browser Assistant

<div align="center">

**AI-powered multi-agent productivity companion that monitors your screen, tracks your focus, and actively intervenes with voice alerts when you get distracted.**

<img src="public/assets/happy.png" width="100" alt="Happy - Productive"/> <img src="public/assets/cool.png" width="100" alt="Cool - On Track"/> <img src="public/assets/sad.png" width="100" alt="Sad - Distracted"/> <img src="public/assets/angry.png" width="100" alt="Angry - Strike 3"/>

*Your AI accountability partner with personality*

[▶️ Watch Demo](https://youtu.be/TE2zivjCZro) • [How to Run](#-how-to-run) • [Architecture](#-multi-agent-architecture-deep-dive) • [OpenAI Integration](#-openai-integration-deep-dive)

</div>

---

## What It Does

A **multi-agent AI system** that watches your screen via GPT-5-mini (vision), assesses your productivity with GPT-5.2 every ~2 minutes, and intervenes with **escalating voice alerts** when you get distracted — from gentle reminders to **forcefully switching your window** back to work. Includes a **carrot & stick** motivation system: get penalized (virtual bank deductions) when distracted, and rewarded (virtual treat orders) when productive.

---

## 📸 Screenshots

<div align="center">

### 🚨 Agent Intervening — Voice Alert in Action

<img src="readme-images/image 19.png" width="800" alt="Agent Intervening with Voice Alert"/>

*The AI detects you're distracted and speaks to you with an escalating voice alert*

---

| Dashboard & Tasks | Screen Monitoring | Strike System |
|:-----------------:|:-----------------:|:-------------:|
| <img src="readme-images/image 14.png" width="280" alt="Dashboard"/> | <img src="readme-images/image 16.png" width="280" alt="Screen Monitoring"/> | <img src="readme-images/image 17.png" width="280" alt="Strike System"/> |

| Voice Response | Carrot & Stick |
|:--------------:|:--------------:|
| <img src="readme-images/image 18.png" width="350" alt="Voice Response"/> | <img src="readme-images/image 19.png" width="350" alt="Rewards & Penalties"/> |

</div>

---

## 🚀 How to Run

### Prerequisites
- Node.js 18+ & [pnpm](https://pnpm.io/)
- Python 3.12+ & [uv](https://github.com/astral-sh/uv)
- OpenAI API key

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/productivity-browser-assistant.git
cd productivity-browser-assistant

# Frontend
pnpm install

# Backend
cd backend
uv sync
cd ..
```

### 2. Set up environment

```bash
echo "OPENAI_API_KEY=sk-your-key-here" > .env
```

### 3. Run the app

**Terminal 1 — Backend:**
```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
pnpm dev
```

**Open:** http://localhost:3000

---

## 🎮 Demo Steps

1. **Add tasks** — Type your goals in the "Brain Dump" box and click **"Extract Tasks"**
2. **Share your screen** — Click the **"Screen"** button → select a window or entire screen
3. **Enable auto mode** — Click **"Auto (1m)"** to start the multi-agent system
4. **Get distracted** — Browse YouTube, Twitter, or any non-work site
5. **Experience an interjection** — The AI will speak to you with a voice alert!
6. **Report progress** — Use the voice button to tell the AI what you've completed
7. **Hit strike 3** — Keep ignoring alerts and get forcefully redirected to Cursor/VS Code

---

## 📝 Project Write-up

> A multi-agent productivity system with real-time screen monitoring. Three AI agents collaborate: an Observer (GPT-5-mini vision every 30s), a Compaction agent (GPT-5-mini summaries every 30 min), and a Manager (GPT-5.2 reasoning decisions every ~2 min). When distracted, the system speaks to you via TTS and accepts voice responses via Whisper; GPT-4o-mini parses the transcript to mark tasks complete. A 3-strike escalation system goes from gentle reminders to forcefully switching your window back to work, with carrot & stick motivation (penalties + rewards).

---

## 🤖 OpenAI Usage Write-up

> **GPT-5-mini (vision)** — Observes screenshots every 30s, extracting app names, window titles, and detailed content descriptions. **GPT-5.2** — Powers the Manager agent's productivity decisions using reasoning over observations + tasks. **GPT-5-mini (text)** — Handles brain dump → task extraction and 30‑min compaction summaries. **GPT-4o-mini** — Parses voice transcripts to decide task completion/compliance. **TTS-1 (Nova voice)** — Generates natural, emotionally‑escalating voice alerts. **Whisper-1** — Real-time speech-to-text for hands-free progress reporting. All five OpenAI models work in concert.

---

## 🏗️ Multi-Agent Architecture Deep Dive

This system uses **three specialized AI agents** that work in concert, each with a specific role and cadence:

### Agent 1: Observer (Every 30 seconds)

```
┌─────────────────────────────────────────────────────────────────────┐
│                       OBSERVER AGENT                                │
│                    Interval: 30 seconds                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   [Screen Capture via WebRTC]                                       │
│            ↓                                                        │
│   [Base64 encode frame]                                             │
│            ↓                                                        │
│   ┌─────────────────────────────────────┐                           │
│   │        GPT-5-mini Vision API        │                           │
│   │                                     │                           │
│   │  System: "You are an observer.      │                           │
│   │  Describe what you see factually.   │                           │
│   │  Do NOT make judgments."            │                           │
│   │                                     │                           │
│   │  Output JSON:                       │                           │
│   │  - window_title                     │                           │
│   │  - app_name                         │                           │
│   │  - description (2-3 paragraphs)     │                           │
│   └─────────────────────────────────────┘                           │
│            ↓                                                        │
│   [Store in SQLite: observations table]                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Purpose:** Pure observation without judgment. Creates a factual log of what's on screen.

**OpenAI Model:** `gpt-5-mini` with vision capability

**Key Design Decision:** The Observer never decides if you're productive — it just records facts. This separation of concerns keeps observations unbiased and allows the Manager to make decisions with full context.

---

### Agent 2: Compaction (Every 30 minutes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     COMPACTION AGENT                                │
│                   Interval: 30 minutes                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   [Query: SELECT * FROM observations WHERE timestamp > 30min ago]   │
│            ↓                                                        │
│   [Collect 60+ observations from the window]                        │
│            ↓                                                        │
│   ┌─────────────────────────────────────┐                           │
│   │         GPT-5-mini API              │                           │
│   │                                     │                           │
│   │  System: "Summarize activity over   │                           │
│   │  the last 30 minutes."              │                           │
│   │                                     │                           │
│   │  Output:                            │                           │
│   │  - 2 paragraph summary              │                           │
│   │  - Apps used                        │                           │
│   │  - Activity patterns                │                           │
│   └─────────────────────────────────────┘                           │
│            ↓                                                        │
│   [Store in SQLite: compactions table]                              │
│            ↓                                                        │
│   ┌─────────────────────────────────────┐                           │
│   │     STRIKE RESET LOGIC              │                           │
│   │                                     │                           │
│   │  IF strikes ≤ 3 in window:          │                           │
│   │     → Reset strikes to 0            │                           │
│   │     → "Good behavior" reward        │                           │
│   │  ELSE:                              │                           │
│   │     → Keep accumulating             │                           │
│   │     → Needs improvement             │                           │
│   └─────────────────────────────────────┘                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Purpose:** Memory management. Compresses 30 minutes of granular observations into a digestible summary. Also handles "good behavior" rewards.

**OpenAI Model:** `gpt-5-mini`

**Key Design Decision:** The Compaction agent provides long-term context without overwhelming the Manager with 60+ individual observations. It also implements the "forgiveness" mechanism — if you kept your distractions under control (≤3 strikes), you get a fresh start.

---

### Agent 3: Manager (Every ~2 minutes, randomized)

```
┌─────────────────────────────────────────────────────────────────────┐
│                       MANAGER AGENT                                 │
│               Interval: 15-25 seconds (randomized)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   [Gather Context]                                                  │
│   ├── Current task list (from SQLite)                               │
│   ├── Recent observations (last 5 minutes)                          │
│   └── Latest 30-min compaction summary                              │
│            ↓                                                        │
│   ┌─────────────────────────────────────┐                           │
│   │          GPT-5.2 API                │                           │
│   │    (Most capable reasoning)         │                           │
│   │                                     │                           │
│   │  System: "You are the Manager.      │                           │
│   │  Determine if user is productive    │                           │
│   │  toward their goals."               │                           │
│   │                                     │                           │
│   │  Input:                             │                           │
│   │  - Task list with status            │                           │
│   │  - Recent screen observations       │                           │
│   │  - 30-min activity summary          │                           │
│   │                                     │                           │
│   │  Output JSON:                       │                           │
│   │  - is_productive: bool              │                           │
│   │  - reasoning: string                │                           │
│   │  - interjection: bool               │                           │
│   │  - interjection_message: string     │                           │
│   │  - tasks_to_complete: string[]      │                           │
│   └─────────────────────────────────────┘                           │
│            ↓                                                        │
│   [Decision Branch]                                                 │
│            │                                                        │
│   ┌────────┴────────┐                                               │
│   │                 │                                               │
│   ↓                 ↓                                               │
│ PRODUCTIVE      DISTRACTED                                          │
│   │                 │                                               │
│   ↓                 ↓                                               │
│ [Log only]    [Trigger Interjection]                                │
│                     │                                               │
│                     ├── Increment strike (cap at 3)                 │
│                     ├── Save pending_interjection                   │
│                     ├── Deduct SBI Bank penalty                     │
│                     └── Set mood (cool→sad→angry)                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Purpose:** The decision-maker. Weighs observations against your task list and decides when to intervene.

**OpenAI Model:** `gpt-5.2` (most capable model for complex reasoning)

**Key Design Decision:** The Manager uses randomized intervals (15-25s) to prevent users from "gaming" the system by knowing exactly when checks occur. It also respects pending interjections — won't pile on if you're already being alerted.

---

### The Complete Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MULTI-AGENT PIPELINE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                     │
│  │ OBSERVER │ ──→ │COMPACTION│ ──→ │ MANAGER  │                     │
│  │  (30s)   │     │  (30min) │     │ (~2min)  │                     │
│  └────┬─────┘     └────┬─────┘     └────┬─────┘                     │
│       │                │                │                           │
│       ↓                ↓                ↓                           │
│  observations     compactions     manager_decisions                 │
│     table            table             table                        │
│       │                │                │                           │
│       └────────────────┴────────────────┘                           │
│                        │                                            │
│                        ↓                                            │
│              ┌─────────────────┐                                    │
│              │   INTERJECTION  │                                    │
│              │      FLOW       │                                    │
│              └────────┬────────┘                                    │
│                       │                                             │
│         ┌─────────────┼─────────────┐                               │
│         │             │             │                               │
│         ↓             ↓             ↓                               │
│    Strike 1      Strike 2      Strike 3+                            │
│    (Gentle)       (Firm)       (Stern)                              │
│         │             │             │                               │
│         ↓             ↓             ↓                               │
│    ┌────────┐    ┌────────┐    ┌────────┐                           │
│    │TTS-1   │    │TTS-1   │    │TTS-1   │                           │
│    │"Hey, I │    │"Second │    │"Strike │                           │
│    │noticed"│    │warning"│    │three!" │                           │
│    └───┬────┘    └───┬────┘    └───┬────┘                           │
│        │             │             │                                │
│        ↓             ↓             ↓                                │
│   [Voice Input] [Voice Input]  [NO INPUT]                           │
│        │             │             │                                │
│        ↓             ↓             ↓                                │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐                           │
│   │Whisper-1│   │Whisper-1│   │ FORCE   │                           │
│   │Transcribe   │Transcribe   │REDIRECT │                           │
│   └────┬────┘   └────┬────┘   │to Cursor│                           │
│        │             │        └─────────┘                           │
│        ↓             ↓                                              │
│   ┌──────────────────────┐                                          │
│   │  GPT-4o-mini:        │                                          │
│   │  Assess compliance   │                                          │
│   │  Mark tasks done     │                                          │
│   │  Trigger rewards     │                                          │
│   └──────────────────────┘                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔌 OpenAI Integration Deep Dive

This project uses OpenAI models across these integration points:

### 1. GPT-5-mini (Vision) — Screen Understanding

```python
# Observer Agent - Every 30 seconds
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[
        {
            "role": "system",
            "content": """You are an observer. Describe what you see factually.
Do NOT make judgments about productivity."""
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Observe and describe this screen:"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{image_data}", "detail": "low"}
                }
            ]
        }
    ],
    response_format={"type": "json_object"}
)
```

**Why GPT-5-mini (vision)?** It's fast and capable for screen understanding. We use `detail: "low"` for faster processing since we don't need pixel-perfect analysis.

---

### 2. GPT-5.2 — Complex Reasoning (Manager Agent)

```python
# Manager Agent - Productivity assessment
response = client.chat.completions.create(
    model="gpt-5.2",
    messages=[
        {
            "role": "system",
            "content": """You are the Manager Agent. Your job is to determine 
if the user is being productive toward their goals.

You have access to:
1. The user's task list
2. Recent observations from the Observer Agent
3. A 30-minute summary from the Compaction Agent

Respond in JSON with: is_productive, reasoning, interjection, 
interjection_message, tasks_to_complete"""
        },
        {"role": "user", "content": context}
    ],
    response_format={"type": "json_object"}
)
```

**Why GPT-5.2 for Manager?** This is the critical decision point. We need the most capable reasoning model to weigh multiple factors: Are they on YouTube for research or procrastination? Did they switch apps for a legitimate reason? GPT-5.2 handles nuance.

---

### 3. GPT-5-mini — Fast Text Processing

Used for two different purposes:

**A) Brain Dump → Task Extraction**
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[
        {
            "role": "system",
            "content": """Extract clear, actionable tasks from the user's brain dump.
Rules: 3-7 concrete tasks, start with verb, under 10 words each."""
        },
        {"role": "user", "content": brain_dump_text}
    ],
    response_format={"type": "json_object"}
)
```

**B) Compaction Summaries**
```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[
        {
            "role": "system",
            "content": "Summarize the user's activity over the last 30 minutes."
        },
        {"role": "user", "content": observations_text}
    ]
)
```

**Why GPT-5-mini?** These tasks are straightforward text processing. Mini is faster and efficient while staying accurate for structured extraction and summaries.

---

### 4. GPT-4o-mini — Voice Response Assessment

```python
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {
            "role": "system",
            "content": """Assess the developer's spoken progress report.
Determine which tasks they completed and if they're being compliant."""
        },
        {"role": "user", "content": f"Task list:\n{tasks}\n\nDeveloper said: \"{transcript}\""}
    ],
    response_format={"type": "json_object"}
)
```

**Why GPT-4o-mini?** It's well-suited for transcript parsing and task matching, keeping latency low for voice interjection loops.

---

### 5. TTS-1 — Voice Alerts with Emotional Escalation

```python
# Generate voice alert with strike-based tone
def _interjection_script(message: str, strike_count: int, penalty: float) -> str:
    if strike_count == 1:
        return f"Hey, I noticed you're distracted. {message} I'm deducting {penalty} rupees..."
    elif strike_count == 2:
        return f"This is your second warning. {message} You're losing money..."
    else:
        return f"Strike three. That's it. I've had enough. Get back to work. Now."

response = client.audio.speech.create(
    model="tts-1",
    voice="nova",  # Female voice, clear and authoritative
    input=script,
    response_format="mp3"
)
```

**Why TTS-1 with Nova?** Voice alerts are more attention-grabbing than visual notifications. The Nova voice is clear, professional, and can convey frustration at strike 3 effectively. We dynamically adjust the script tone based on strike count.

---

### 6. Whisper-1 — Voice Input for Hands-Free Reporting

```python
# Transcribe user's voice response
audio_file = io.BytesIO(contents)
audio_file.name = "audio.webm"

transcript = client.audio.transcriptions.create(
    model="whisper-1",
    file=audio_file,
    response_format="text"
)
```

**Why Whisper?** When you're interrupted by an AI, typing a response breaks flow. Voice input lets you say "I finished the login page and fixed the bug" naturally, which then gets parsed by GPT-4o-mini to mark tasks complete.

---

### OpenAI Usage Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OPENAI API USAGE MAP                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  USER ACTIONS                        OPENAI MODELS TRIGGERED        │
│  ────────────                        ──────────────────────         │
│                                                                     │
│  📝 Brain Dump ──────────────────→  [GPT-5-mini] Task extraction   │
│                                                                     │
│  🖥️ Screen Share (every 30s) ───→  [GPT-5-mini Vision] Observation  │
│                                                                     │
│  ⏰ Every 30 minutes ───────────→  [GPT-5-mini] Compaction          │
│                                                                     │
│  ⏰ Every ~2 minutes ───────────→  [GPT-5.2] Manager decision       │
│         │                                                           │
│         └── If distracted ──────→  [TTS-1] Voice alert              │
│                   │                                                 │
│                   └── User speaks → [Whisper-1] Transcription       │
│                           │                                         │
│                           └───────→ [GPT-4o-mini] Task assessment   │
│                                                                     │
│  ════════════════════════════════════════════════════════════════   │
│                                                                     │
│  COST OPTIMIZATION:                                                 │
│  • Vision uses detail:"low" (faster, cheaper)                       │
│  • GPT-5.2 only for critical Manager decisions                      │
│  • GPT-5-mini for observation + compaction + brain dump             │
│  • GPT-4o-mini for task assessment from transcripts                 │
│  • TTS/Whisper only when interjection triggered                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🥕 Carrot & Stick System

### 💸 The Stick: Virtual Bank Penalties

When you get distracted, the system deducts money from your virtual SBI Bank account:

| Strike | Penalty | Message |
|:------:|:-------:|:--------|
| 1 | ₹50 | "I'm deducting 50 rupees from your bank account..." |
| 2 | ₹100 | "You're losing money every time you get distracted..." |
| 3+ | ₹200 | "Strike three. That's it." |

### 🎁 The Carrot: Virtual Rewards

When you complete tasks and report via voice, the system "orders" treats:

| Progress | Reward |
|:--------:|:------:|
| 1 task | Dairy Milk Silk Chocolate |
| 50% tasks | Cold Coffee + Cookies Pack |
| All tasks | Premium Snack Box + Ice Cream |

---

## 🎭 Strike Escalation & Mood System

| Strike | Mascot | TTS Tone | Voice Input | Action |
|:------:|:------:|:--------:|:-----------:|:------:|
| 0 | <img src="public/assets/cool.png" width="50"/> | — | — | Productive |
| 1 | <img src="public/assets/sad.png" width="50"/> | Gentle | ✅ Allowed | Ask for progress |
| 2 | <img src="public/assets/sad.png" width="50"/> | Firm | ✅ Allowed | Ask for progress |
| 3+ | <img src="public/assets/angry.png" width="50"/> | Stern | ❌ Disabled | Force redirect |

**Strike Reset:** If you keep distractions ≤3 in a 30-minute window, the Compaction agent resets your strikes to 0.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, ShadcnUI |
| **Backend** | Python 3.12, FastAPI, OpenAI SDK |
| **Database** | SQLite (local, privacy-first) |
| **AI Models** | GPT-5.2 (reasoning), GPT-5-mini (vision + text), GPT-4o-mini (task parsing), TTS-1, Whisper-1 |
| **Browser APIs** | WebRTC (screen capture), Web Audio (TTS playback), MediaRecorder (voice) |
| **OS Integration** | AppleScript (macOS window focus control) |

---

## 📡 API Endpoints

<details>
<summary><strong>Core Endpoints</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/analyze-braindump` | Extract tasks (GPT-5-mini) |
| GET | `/api/tasks` | Get all tasks |
| POST | `/api/tasks` | Add a task |
| PATCH | `/api/tasks/{id}` | Update task status |
| DELETE | `/api/tasks/{id}` | Delete task |

</details>

<details>
<summary><strong>Multi-Agent Endpoints</strong></summary>

| Method | Endpoint | OpenAI Model | Description |
|--------|----------|:------------:|-------------|
| POST | `/api/observe` | GPT-5-mini (Vision) | Observer agent |
| POST | `/api/compact` | GPT-5-mini | Compaction agent |
| POST | `/api/manager` | GPT-5.2 | Manager agent |
| GET | `/api/next-manager-interval` | — | Random interval |

</details>

<details>
<summary><strong>Voice & Interjection Endpoints</strong></summary>

| Method | Endpoint | OpenAI Model | Description |
|--------|----------|:------------:|-------------|
| GET | `/api/interjection` | — | Check pending |
| POST | `/api/interjection/acknowledge` | — | Acknowledge |
| POST | `/api/interjection-speech` | TTS-1 | Generate voice MP3 |
| POST | `/api/non-compliance-speech` | TTS-1 | Stern TTS |
| POST | `/api/transcribe` | Whisper-1 | Voice → text |
| POST | `/api/assess-task-completion` | GPT-4o-mini | Parse voice response |
| GET | `/api/strike-status` | — | Current strikes |

</details>

<details>
<summary><strong>Carrot & Stick Endpoints</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sbi/account` | Virtual bank balance |
| GET | `/api/sbi/transactions` | Penalty history |
| POST | `/api/sbi/penalty` | Deduct penalty |
| GET | `/api/blinkit/orders` | Reward history |
| POST | `/api/blinkit/reward` | Place reward order |

</details>

<details>
<summary><strong>Local Mode (macOS)</strong></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/focus-browser` | Focus browser + switch to app tab |
| POST | `/api/focus-productive-app` | Focus Cursor/VS Code |

</details>

---

## 🔒 Privacy & Security

- ✅ Screen capture requires **explicit user permission**
- ✅ All data stored **locally** in SQLite
- ✅ Screenshots are **not persisted** — only text descriptions
- ✅ Voice recordings are **not persisted** — only transcripts
- ✅ No data sent to external servers (except OpenAI API calls)
- ✅ Bank/rewards are **purely fictional** — no real money involved

---

## 📂 Project Structure

```
├── app/
│   ├── page.tsx          # Main UI + interjection modal
│   ├── layout.tsx        # App layout
│   └── globals.css       # Tailwind styles
├── backend/
│   ├── main.py           # FastAPI server + all 3 agents
│   ├── productivity.db   # SQLite database
│   └── pyproject.toml    # Python deps (uv)
├── components/ui/        # ShadcnUI components
├── public/assets/        # Mascot mood images (happy, cool, sad, angry)
├── readme-images/        # App screenshots for README
├── mcps/                 # MCP server configs (SBI Bank, Blinkit)
├── .env                  # OPENAI_API_KEY
└── package.json          # Node deps (pnpm)
```

---

## 🗄️ Database Schema

```sql
-- User tasks
tasks (id, text, done, created_at)

-- Observer outputs (every 30s)
observations (id, timestamp, window_title, app_name, description, elapsed_ms)

-- Compaction summaries (every 30min)
compactions (id, timestamp, period_start, period_end, observation_count, summary, apps_used)

-- Manager decisions
manager_decisions (id, timestamp, is_productive, reasoning, interjection, interjection_message)

-- Pending interjections (for frontend polling)
pending_interjections (id, timestamp, message, acknowledged)

-- Strike tracking (singleton)
focus_strikes (id=1, strike_count, window_start, updated_at)

-- Virtual bank (stick)
sbi_account (id=1, account_number, balance, ...)
sbi_transactions (id, timestamp, type, amount, balance_after, description)

-- Virtual rewards (carrot)
blinkit_orders (id, timestamp, order_id, item, status, reason)
```

---

## 🎥 Demo Video

<div align="center">

[![Watch the Demo](https://img.youtube.com/vi/TE2zivjCZro/maxresdefault.jpg)](https://youtu.be/TE2zivjCZro)

**[▶️ Watch on YouTube](https://youtu.be/TE2zivjCZro)**

*2-minute demo showing the multi-agent system in action*

</div>

---

## 📜 License

MIT

---

<div align="center">

**Built for the OpenAI Hackathon 2026**

<img src="public/assets/happy.png" width="60"/> <img src="public/assets/cool.png" width="60"/> <img src="public/assets/sad.png" width="60"/> <img src="public/assets/angry.png" width="60"/>

*Stay focused. Get things done. Or else.*

</div>
