"""
Multi-Agent Productivity Assistant Backend

Three agents:
1. Observer Agent (30s) - Describes what's on screen, no inference
2. Compaction Agent (30m) - Summarizes last 30 minutes of observations
3. Manager Agent (45-60s random) - Decides if user is productive, can interject
"""

import base64
import json
import logging
import os
import random
import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("productivity")

load_dotenv(Path(__file__).parent.parent / ".env")

# ============================================================
# CONFIGURATION
# ============================================================
CONFIG = {
    "observer_interval_seconds": 30,        # 30-second agent
    "compaction_interval_seconds": 1800,    # 30-minute agent (1800s = 30min)
    "manager_min_interval_seconds": 45,     # Manager random min
    "manager_max_interval_seconds": 60,     # Manager random max
}
# ============================================================

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
DB_PATH = Path(__file__).parent / "productivity.db"


def init_db():
    """Initialize SQLite database with multi-agent tables"""
    conn = sqlite3.connect(DB_PATH)
    
    # Tasks table - user's daily objectives
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)
    
    # Observer Agent outputs (30-second observations)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            window_title TEXT,
            app_name TEXT,
            description TEXT NOT NULL,
            elapsed_ms REAL
        )
    """)
    
    # Compaction Agent outputs (30-minute summaries)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS compactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            observation_count INTEGER,
            summary TEXT NOT NULL,
            apps_used TEXT,
            elapsed_ms REAL
        )
    """)
    
    # Manager Agent outputs (decisions + interjections)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS manager_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            is_productive INTEGER,
            reasoning TEXT NOT NULL,
            interjection INTEGER DEFAULT 0,
            interjection_message TEXT,
            tasks_updated TEXT,
            elapsed_ms REAL
        )
    """)
    
    # Pending interjections (for frontend to poll)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pending_interjections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            message TEXT NOT NULL,
            acknowledged INTEGER DEFAULT 0
        )
    """)
    
    conn.commit()
    conn.close()
    logger.info(f"Database ready: {DB_PATH}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("=" * 60)
    logger.info("MULTI-AGENT PRODUCTIVITY ASSISTANT")
    logger.info("=" * 60)
    logger.info(f"  Observer Agent:    every {CONFIG['observer_interval_seconds']}s")
    logger.info(f"  Compaction Agent:  every {CONFIG['compaction_interval_seconds']}s (30min)")
    logger.info(f"  Manager Agent:     every {CONFIG['manager_min_interval_seconds']}-{CONFIG['manager_max_interval_seconds']}s (random)")
    logger.info("=" * 60)
    yield


app = FastAPI(title="Multi-Agent Productivity Assistant", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Models
# ============================================================

class BrainDumpRequest(BaseModel):
    text: str


class BrainDumpResponse(BaseModel):
    tasks: list[str]
    analysis: str
    elapsed_ms: float


class ObserveRequest(BaseModel):
    image_base64: str


class ObserveResponse(BaseModel):
    window_title: str
    app_name: str
    description: str
    elapsed_ms: float


class CompactionResponse(BaseModel):
    summary: str
    apps_used: list[str]
    observation_count: int
    elapsed_ms: float


class ManagerRequest(BaseModel):
    image_base64: str | None = None  # Optional current screenshot


class ManagerResponse(BaseModel):
    is_productive: bool
    reasoning: str
    interjection: bool
    interjection_message: str | None
    tasks_updated: list[str]
    elapsed_ms: float


class TaskItem(BaseModel):
    id: int
    text: str
    done: bool


class TaskCreate(BaseModel):
    text: str


class InterjectionResponse(BaseModel):
    has_interjection: bool
    message: str | None
    timestamp: str | None


class ConfigResponse(BaseModel):
    observer_interval_seconds: int
    compaction_interval_seconds: int
    manager_min_interval_seconds: int
    manager_max_interval_seconds: int


# ============================================================
# Health & Config
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok", "agents": ["observer", "compaction", "manager"]}


@app.get("/api/config", response_model=ConfigResponse)
def get_config():
    return ConfigResponse(**CONFIG)


# ============================================================
# Brain Dump Analysis
# ============================================================

@app.post("/api/analyze-braindump", response_model=BrainDumpResponse)
def analyze_braindump(req: BrainDumpRequest):
    """Analyze brain dump text and extract actionable tasks"""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    logger.info("")
    logger.info("🧠 BRAIN DUMP ANALYSIS")
    logger.info("─" * 40)
    logger.info(f"  Input: {len(req.text)} chars")
    
    start = time.perf_counter()

    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {
                "role": "system",
                "content": """Extract clear, actionable tasks from the user's brain dump.
Rules:
- Extract 3-7 concrete tasks (start with a verb)
- Keep tasks concise (under 10 words)
- Provide 1-sentence analysis

Respond in JSON: {"tasks": ["task1", ...], "analysis": "brief analysis"}"""
            },
            {"role": "user", "content": req.text}
        ],
        response_format={"type": "json_object"},
        # max_tokens=300
    )

    elapsed = (time.perf_counter() - start) * 1000
    result = json.loads(response.choices[0].message.content)

    logger.info(f"  Tasks: {len(result.get('tasks', []))}")
    logger.info(f"  Time: {elapsed:.0f}ms")
    logger.info("─" * 40)

    return BrainDumpResponse(
        tasks=result.get("tasks", []),
        analysis=result.get("analysis", ""),
        elapsed_ms=round(elapsed, 1)
    )


# ============================================================
# Task Management
# ============================================================

@app.get("/api/tasks", response_model=list[TaskItem])
def get_tasks():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT id, text, done FROM tasks ORDER BY id").fetchall()
    conn.close()
    return [TaskItem(id=r["id"], text=r["text"], done=bool(r["done"])) for r in rows]


@app.post("/api/tasks", response_model=TaskItem)
def create_task(task: TaskCreate):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute(
        "INSERT INTO tasks (text, done, created_at) VALUES (?, 0, ?)",
        (task.text, datetime.now().isoformat())
    )
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return TaskItem(id=task_id, text=task.text, done=False)


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, done: bool):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE tasks SET done = ? WHERE id = ?", (1 if done else 0, task_id))
    conn.commit()
    conn.close()
    return {"status": "updated"}


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}


# ============================================================
# AGENT 1: Observer (30-second agent)
# ============================================================

@app.post("/api/observe", response_model=ObserveResponse)
def observe(req: ObserveRequest):
    """
    Observer Agent - Runs every 30 seconds
    Describes what's on screen without making judgments
    """
    start = time.perf_counter()
    
    logger.info("")
    logger.info("🔍 OBSERVER AGENT")
    logger.info("─" * 40)
    
    # Clean base64
    image_data = req.image_base64
    if "," in image_data:
        image_data = image_data.split(",")[1]
    image_data = re.sub(r'\s+', '', image_data)
    
    try:
        decoded = base64.b64decode(image_data)
        logger.info(f"  Image: {len(decoded) / 1024:.0f} KB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")
    
    # Call GPT-5-mini vision for pure observation
    api_start = time.perf_counter()
    
    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {
                "role": "system",
                "content": """You are an observer. Describe what you see on this screen factually.
Do NOT make judgments about productivity or what the user should do.
Just observe and record.

Respond in JSON:
{
  "window_title": "The title of the main window/tab visible",
  "app_name": "The application name (e.g., Chrome, VS Code, Slack)",
  "description": "2-3 paragraphs describing in detail what is visible on screen. Include: what app is open, what content is displayed, any text you can read, any UI elements visible, what the user appears to be looking at or working on. Be thorough and factual."
}"""
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
        response_format={"type": "json_object"},
        # max_tokens=500
    )
    
    api_time = (time.perf_counter() - api_start) * 1000
    result = json.loads(response.choices[0].message.content)
    
    window_title = result.get("window_title", "Unknown")
    app_name = result.get("app_name", "Unknown")
    description = result.get("description", "No description")
    
    # Save to database
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO observations (timestamp, window_title, app_name, description, elapsed_ms)
           VALUES (?, ?, ?, ?, ?)""",
        (datetime.now().isoformat(), window_title, app_name, description, api_time)
    )
    conn.commit()
    conn.close()
    
    total_time = (time.perf_counter() - start) * 1000
    
    logger.info(f"  App: {app_name}")
    logger.info(f"  Window: {window_title[:50]}...")
    logger.info(f"  API: {api_time:.0f}ms | Total: {total_time:.0f}ms")
    logger.info("─" * 40)
    
    return ObserveResponse(
        window_title=window_title,
        app_name=app_name,
        description=description,
        elapsed_ms=round(total_time, 1)
    )


# ============================================================
# AGENT 2: Compaction (30-minute agent)
# ============================================================

@app.post("/api/compact", response_model=CompactionResponse)
def compact():
    """
    Compaction Agent - Runs every 30 minutes
    Summarizes all observations from the last 30 minutes
    """
    start = time.perf_counter()
    
    logger.info("")
    logger.info("📦 COMPACTION AGENT")
    logger.info("─" * 40)
    
    # Get observations from last 30 minutes
    cutoff = (datetime.now() - timedelta(minutes=30)).isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    observations = conn.execute(
        """SELECT timestamp, app_name, window_title, description 
           FROM observations WHERE timestamp > ? ORDER BY timestamp ASC""",
        (cutoff,)
    ).fetchall()
    conn.close()
    
    if not observations:
        raise HTTPException(status_code=400, detail="No observations in the last 30 minutes")
    
    logger.info(f"  Observations: {len(observations)}")
    
    # Build observations text
    obs_text = "\n\n".join([
        f"[{o['timestamp']}] {o['app_name']} - {o['window_title']}\n{o['description']}"
        for o in observations
    ])
    
    # Get unique apps
    apps_seen = list(set(o['app_name'] for o in observations))
    
    # Call GPT-4o-mini to summarize
    api_start = time.perf_counter()
    
    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {
                "role": "system",
                "content": """Summarize the user's activity over the last 30 minutes based on these observations.

Write 2 paragraphs:
1. What the user has been looking at and working on (apps, content, activities)
2. Overall patterns - main focus areas, any context switching, general productivity impression

Be factual and descriptive. This summary will be used by a manager agent to assess productivity."""
            },
            {"role": "user", "content": f"Observations from the last 30 minutes:\n\n{obs_text}"}
        ],
        # max_tokens=400
    )
    
    api_time = (time.perf_counter() - api_start) * 1000
    summary = response.choices[0].message.content.strip()
    
    # Save to database
    period_start = observations[0]['timestamp']
    period_end = observations[-1]['timestamp']
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO compactions (timestamp, period_start, period_end, observation_count, summary, apps_used, elapsed_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (datetime.now().isoformat(), period_start, period_end, len(observations), summary, json.dumps(apps_seen), api_time)
    )
    conn.commit()
    conn.close()
    
    total_time = (time.perf_counter() - start) * 1000
    
    logger.info(f"  Apps: {', '.join(apps_seen)}")
    logger.info(f"  API: {api_time:.0f}ms | Total: {total_time:.0f}ms")
    logger.info(f"  Summary: {summary[:100]}...")
    logger.info("─" * 40)
    
    return CompactionResponse(
        summary=summary,
        apps_used=apps_seen,
        observation_count=len(observations),
        elapsed_ms=round(total_time, 1)
    )


# ============================================================
# AGENT 3: Manager (45-60 second random interval)
# ============================================================

@app.post("/api/manager", response_model=ManagerResponse)
def manager_check(req: ManagerRequest):
    """
    Manager Agent - Runs every 45-60 seconds (random)
    Decides if user is productive, can update tasks, can INTERJECT
    Uses GPT-5-mini (most intelligent model available)
    """
    start = time.perf_counter()
    
    logger.info("")
    logger.info("👔 MANAGER AGENT")
    logger.info("─" * 40)
    
    # Get current tasks
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    tasks = conn.execute("SELECT id, text, done FROM tasks").fetchall()
    task_list = [f"{'[x]' if t['done'] else '[ ]'} {t['text']}" for t in tasks]
    tasks_str = "\n".join(task_list) if task_list else "No tasks defined"
    
    # Get recent observations (last 5 minutes)
    obs_cutoff = (datetime.now() - timedelta(minutes=5)).isoformat()
    recent_obs = conn.execute(
        """SELECT timestamp, app_name, description FROM observations 
           WHERE timestamp > ? ORDER BY timestamp DESC LIMIT 10""",
        (obs_cutoff,)
    ).fetchall()
    
    # Get latest compaction summary
    latest_compaction = conn.execute(
        "SELECT summary, apps_used FROM compactions ORDER BY id DESC LIMIT 1"
    ).fetchone()
    
    conn.close()
    
    # Build context
    obs_context = "\n\n".join([
        f"[{o['timestamp']}] {o['app_name']}: {o['description'][:200]}..."
        for o in recent_obs
    ]) if recent_obs else "No recent observations"
    
    compaction_context = f"30-minute summary: {latest_compaction['summary']}" if latest_compaction else "No 30-minute summary yet"
    
    logger.info(f"  Tasks: {len(tasks)}")
    logger.info(f"  Recent observations: {len(recent_obs)}")
    logger.info("")
    logger.info("  [INPUT TO MANAGER]")
    logger.info(f"  Tasks: {tasks_str}")
    if recent_obs:
        logger.info("  Recent activity:")
        for o in recent_obs[:3]:  # Show last 3
            logger.info(f"    - {o['app_name']}: {o['description'][:60]}...")
    logger.info("")
    
    # Call GPT-4o (best model) for decision making
    api_start = time.perf_counter()
    
    response = client.chat.completions.create(
        model="gpt-5.2",  # Using GPT-5.2 as the most capable model
        messages=[
            {
                "role": "system",
                "content": """You are the Manager Agent. Your job is to determine if the user is being productive toward their goals.

You have access to:
1. The user's task list (their daily objectives)
2. Recent observations from the Observer Agent (what's on their screen)
3. A 30-minute summary from the Compaction Agent

Your responsibilities:
- Determine if current activity aligns with their tasks
- Identify if they are distracted or off-task
- INTERJECT if they are clearly being unproductive (e.g., social media when they should be working)
- Suggest task completions if work appears done

Respond in JSON:
{
  "is_productive": true/false,
  "reasoning": "2-3 sentences explaining your assessment",
  "interjection": true/false (true ONLY if user is clearly distracted/unproductive),
  "interjection_message": "A direct but kind message to get them back on track" or null,
  "tasks_to_complete": ["exact task text that appears done"] or []
}

Be fair - not every non-work activity warrants an interjection. Only interject for clear distractions during work time."""
            },
            {
                "role": "user",
                "content": f"""USER'S TASKS:
{tasks_str}

RECENT SCREEN OBSERVATIONS (last 5 min):
{obs_context}

{compaction_context}

Assess the user's productivity and decide if an interjection is needed."""
            }
        ],
        response_format={"type": "json_object"},
        # max_tokens=400
    )
    
    api_time = (time.perf_counter() - api_start) * 1000
    result = json.loads(response.choices[0].message.content)
    
    is_productive = result.get("is_productive", True)
    reasoning = result.get("reasoning", "")
    interjection = result.get("interjection", False)
    interjection_message = result.get("interjection_message")
    tasks_to_complete = result.get("tasks_to_complete", [])
    
    # Mark tasks as complete if suggested
    tasks_updated = []
    if tasks_to_complete:
        conn = sqlite3.connect(DB_PATH)
        for task_text in tasks_to_complete:
            conn.execute(
                "UPDATE tasks SET done = 1 WHERE text LIKE ? AND done = 0",
                (f"%{task_text}%",)
            )
            tasks_updated.append(task_text)
        conn.commit()
        conn.close()
    
    # Handle interjection
    if interjection and interjection_message:
        logger.info("")
        logger.info("🚨 " + "=" * 36 + " 🚨")
        logger.info("🚨        INTERJECTION            🚨")
        logger.info("🚨 " + "=" * 36 + " 🚨")
        logger.info(f"   {interjection_message}")
        logger.info("🚨 " + "=" * 36 + " 🚨")
        logger.info("")
        
        # Save pending interjection for frontend
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO pending_interjections (timestamp, message, acknowledged) VALUES (?, ?, 0)",
            (datetime.now().isoformat(), interjection_message)
        )
        conn.commit()
        conn.close()
    
    # Save manager decision
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO manager_decisions 
           (timestamp, is_productive, reasoning, interjection, interjection_message, tasks_updated, elapsed_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            datetime.now().isoformat(),
            1 if is_productive else 0,
            reasoning,
            1 if interjection else 0,
            interjection_message,
            json.dumps(tasks_updated),
            api_time
        )
    )
    conn.commit()
    conn.close()
    
    total_time = (time.perf_counter() - start) * 1000
    
    logger.info("")
    logger.info("  [MANAGER OUTPUT]")
    logger.info(f"  ┌─ Productive: {is_productive}")
    logger.info(f"  ├─ Interjection: {interjection}")
    if tasks_updated:
        logger.info(f"  ├─ Tasks completed: {tasks_updated}")
    logger.info(f"  ├─ API: {api_time:.0f}ms | Total: {total_time:.0f}ms")
    logger.info(f"  └─ Reasoning: {reasoning}")
    logger.info("─" * 40)
    
    return ManagerResponse(
        is_productive=is_productive,
        reasoning=reasoning,
        interjection=interjection,
        interjection_message=interjection_message,
        tasks_updated=tasks_updated,
        elapsed_ms=round(total_time, 1)
    )


# ============================================================
# Interjection Polling (for frontend)
# ============================================================

@app.get("/api/interjection", response_model=InterjectionResponse)
def check_interjection():
    """Check for pending interjections"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    pending = conn.execute(
        "SELECT id, timestamp, message FROM pending_interjections WHERE acknowledged = 0 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    
    conn.close()
    
    if pending:
        return InterjectionResponse(
            has_interjection=True,
            message=pending["message"],
            timestamp=pending["timestamp"]
        )
    return InterjectionResponse(has_interjection=False, message=None, timestamp=None)


@app.post("/api/interjection/acknowledge")
def acknowledge_interjection():
    """Acknowledge all pending interjections"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE pending_interjections SET acknowledged = 1 WHERE acknowledged = 0")
    conn.commit()
    conn.close()
    return {"status": "acknowledged"}


# ============================================================
# History endpoints
# ============================================================

@app.get("/api/observations")
def get_observations(limit: int = 50):
    """Get recent observations"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM observations ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/compactions")
def get_compactions(limit: int = 20):
    """Get recent compactions"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM compactions ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/decisions")
def get_decisions(limit: int = 20):
    """Get recent manager decisions"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM manager_decisions ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.delete("/api/history")
def clear_history():
    """Clear all history"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM observations")
    conn.execute("DELETE FROM compactions")
    conn.execute("DELETE FROM manager_decisions")
    conn.execute("DELETE FROM pending_interjections")
    conn.commit()
    conn.close()
    logger.info("All history cleared")
    return {"status": "cleared"}


# ============================================================
# Utility
# ============================================================

@app.get("/api/next-manager-interval")
def get_next_manager_interval():
    """Get a random interval for the next manager check"""
    interval = random.randint(
        CONFIG["manager_min_interval_seconds"],
        CONFIG["manager_max_interval_seconds"]
    )
    return {"interval_seconds": interval}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
