"""
Multi-Agent Productivity Assistant Backend

Three agents:
1. Observer Agent (30s) - Describes what's on screen, no inference
2. Compaction Agent (30m) - Summarizes last 30 minutes of observations
3. Manager Agent (45-60s random) - Decides if user is productive, can interject
"""

import base64
import io
import json
import logging
import os
import platform
import random
import re
import sqlite3
import subprocess
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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
    "manager_min_interval_seconds": 15,    # Manager random min (~2 min)
    "manager_max_interval_seconds": 25,    # Manager random max (~2 min)
    
    # ==================== CARROT & STICK CONFIG ====================
    # SBI Bank Penalty (STICK) - Deduct money on distraction
    "sbi_initial_balance": 10000,           # Starting balance in ₹
    "penalty_strike_1": 50,                 # ₹50 for first strike (gentle)
    "penalty_strike_2": 100,                # ₹100 for second strike (firm)
    "penalty_strike_3": 200,                # ₹200 for third strike (stern)
    "penalty_non_compliance": 150,          # ₹150 for refusing to comply
    
    # Blinkit Rewards (CARROT) - Order treats on task completion
    "reward_single_task": "Dairy Milk Silk Chocolate",
    "reward_half_tasks": "Cold Coffee + Cookies Pack",
    "reward_all_tasks": "Premium Snack Box + Ice Cream",
    # ===============================================================
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
    
    # Focus policy strikes (accumulate within 30-min window, reset by compaction if ≤3)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS focus_strikes (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            strike_count INTEGER DEFAULT 0,
            window_start TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    
    # Migration: add window_start column if it doesn't exist (for existing DBs)
    cursor = conn.execute("PRAGMA table_info(focus_strikes)")
    columns = [row[1] for row in cursor.fetchall()]
    if "window_start" not in columns:
        conn.execute(f"ALTER TABLE focus_strikes ADD COLUMN window_start TEXT DEFAULT '{datetime.now().isoformat()}'")
        logger.info("Migrated focus_strikes table: added window_start column")
    
    conn.execute(
        "INSERT OR IGNORE INTO focus_strikes (id, strike_count, window_start, updated_at) VALUES (1, 0, ?, ?)",
        (datetime.now().isoformat(), datetime.now().isoformat())
    )
    
    # ==================== SBI BANK (STICK) ====================
    # Virtual bank account for penalty deductions
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sbi_account (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            account_number TEXT NOT NULL,
            account_holder TEXT NOT NULL,
            balance REAL NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    
    # Transaction history for penalties
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sbi_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_after REAL NOT NULL,
            description TEXT NOT NULL,
            strike_count INTEGER
        )
    """)
    
    # Initialize SBI account if not exists
    conn.execute(
        """INSERT OR IGNORE INTO sbi_account 
           (id, account_number, account_holder, balance, created_at, updated_at) 
           VALUES (1, 'SBIN0001234567890', 'Productivity User', ?, ?, ?)""",
        (CONFIG["sbi_initial_balance"], datetime.now().isoformat(), datetime.now().isoformat())
    )
    
    # ==================== BLINKIT REWARDS (CARROT) ====================
    # Orders placed as rewards for productivity
    conn.execute("""
        CREATE TABLE IF NOT EXISTS blinkit_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            order_id TEXT NOT NULL,
            item TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT NOT NULL,
            tasks_completed INTEGER,
            total_tasks INTEGER
        )
    """)
    
    conn.commit()
    conn.close()
    logger.info(f"Database ready: {DB_PATH}")
    logger.info(f"  💰 SBI Bank: ₹{CONFIG['sbi_initial_balance']} initial balance")
    logger.info(f"  🛒 Blinkit: Rewards configured")


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
    strike_count: int = 1  # 1–3, for TTS tone escalation
    mood: str = "cool"  # cool, sad, angry, happy - for character display
    tasks_updated: list[str]
    elapsed_ms: float
    # SBI Bank penalty info (for frontend display)
    penalty_amount: float | None = None
    balance_before: float | None = None
    balance_after: float | None = None


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
    strike_count: int | None = None
    mood: str | None = None  # cool, sad, angry, happy - for character display


class InterjectionSpeechRequest(BaseModel):
    message: str
    strike_count: int = 1  # 1–3
    penalty_amount: float | None = None  # Amount deducted from bank
    balance_after: float | None = None  # New balance after penalty


class AssessTaskCompletionRequest(BaseModel):
    transcript: str
    task_list: list[TaskItem]


class AssessTaskCompletionResponse(BaseModel):
    tasks_to_complete: list[str]  # exact task text to mark done
    is_compliant: bool = True  # did developer show progress?
    compliance_message: str | None = None


class NonComplianceSpeechRequest(BaseModel):
    strike_count: int = 1
    tasks_remaining: int = 0


class StrikeStatusResponse(BaseModel):
    strike_count: int
    window_start: str
    is_force_redirect_mode: bool  # True if strikes >= 3


class ConfigResponse(BaseModel):
    observer_interval_seconds: int
    compaction_interval_seconds: int
    manager_min_interval_seconds: int
    manager_max_interval_seconds: int


# ==================== SBI BANK MODELS (STICK) ====================
class SBIAccountResponse(BaseModel):
    account_number: str
    account_holder: str
    balance: float
    currency: str = "INR"
    bank_name: str = "State Bank of India"
    is_demo: bool = True  # Clearly marked as fictional


class SBITransactionResponse(BaseModel):
    id: int
    timestamp: str
    type: str  # "PENALTY" or "CREDIT"
    amount: float
    balance_after: float
    description: str
    strike_count: int | None


class SBIPenaltyRequest(BaseModel):
    strike_count: int = 1
    reason: str = "Distraction detected"


class SBIPenaltyResponse(BaseModel):
    success: bool
    amount_deducted: float
    new_balance: float
    message: str
    transaction_id: int


# ==================== BLINKIT MODELS (CARROT) ====================
class BlinkitOrderResponse(BaseModel):
    order_id: str
    item: str
    status: str  # "PLACED", "CONFIRMED", "DELIVERED"
    reason: str
    timestamp: str
    estimated_delivery: str
    is_demo: bool = True  # Clearly marked as fictional


class BlinkitRewardRequest(BaseModel):
    tasks_completed: int
    total_tasks: int
    reason: str = "Task completion reward"


class BlinkitRewardResponse(BaseModel):
    success: bool
    order: BlinkitOrderResponse | None
    message: str


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
# SBI BANK API (STICK) - Virtual Bank for Penalties
# ============================================================
# ⚠️ DISCLAIMER: This is a FICTIONAL demo bank for demonstration purposes only.
# No real money is involved. State Bank of India branding used for visual authenticity.

@app.get("/api/sbi/account", response_model=SBIAccountResponse)
def get_sbi_account():
    """Get virtual SBI account details (DEMO - No real money)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    account = conn.execute("SELECT * FROM sbi_account WHERE id = 1").fetchone()
    conn.close()
    
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    return SBIAccountResponse(
        account_number=account["account_number"],
        account_holder=account["account_holder"],
        balance=account["balance"]
    )


@app.get("/api/sbi/transactions", response_model=list[SBITransactionResponse])
def get_sbi_transactions(limit: int = 20):
    """Get recent SBI transactions (DEMO)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    txns = conn.execute(
        "SELECT * FROM sbi_transactions ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    
    return [SBITransactionResponse(
        id=t["id"],
        timestamp=t["timestamp"],
        type=t["type"],
        amount=t["amount"],
        balance_after=t["balance_after"],
        description=t["description"],
        strike_count=t["strike_count"]
    ) for t in txns]


@app.post("/api/sbi/penalty", response_model=SBIPenaltyResponse)
def deduct_sbi_penalty(req: SBIPenaltyRequest):
    """
    Deduct penalty from virtual SBI account (DEMO - No real money).
    Called when user is distracted/non-compliant.
    """
    logger.info("")
    logger.info("💸 SBI BANK PENALTY (DEMO)")
    logger.info("─" * 40)
    
    # Determine penalty amount based on strike
    strike = max(1, min(3, req.strike_count))
    if strike == 1:
        amount = CONFIG["penalty_strike_1"]
    elif strike == 2:
        amount = CONFIG["penalty_strike_2"]
    else:
        amount = CONFIG["penalty_strike_3"]
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Get current balance
    account = conn.execute("SELECT balance FROM sbi_account WHERE id = 1").fetchone()
    if not account:
        conn.close()
        raise HTTPException(status_code=404, detail="Account not found")
    
    current_balance = account["balance"]
    new_balance = max(0, current_balance - amount)  # Don't go negative
    
    # Update balance
    conn.execute(
        "UPDATE sbi_account SET balance = ?, updated_at = ? WHERE id = 1",
        (new_balance, datetime.now().isoformat())
    )
    
    # Record transaction
    cursor = conn.execute(
        """INSERT INTO sbi_transactions 
           (timestamp, type, amount, balance_after, description, strike_count)
           VALUES (?, 'PENALTY', ?, ?, ?, ?)""",
        (datetime.now().isoformat(), amount, new_balance, req.reason, strike)
    )
    txn_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    logger.info(f"  Strike: {strike}/3")
    logger.info(f"  Amount: ₹{amount}")
    logger.info(f"  Balance: ₹{current_balance} → ₹{new_balance}")
    logger.info(f"  Reason: {req.reason}")
    logger.info("─" * 40)
    
    return SBIPenaltyResponse(
        success=True,
        amount_deducted=amount,
        new_balance=new_balance,
        message=f"₹{amount} deducted for: {req.reason}. New balance: ₹{new_balance}",
        transaction_id=txn_id
    )


@app.post("/api/sbi/reset")
def reset_sbi_account():
    """Reset SBI account to initial balance (for demo purposes)"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE sbi_account SET balance = ?, updated_at = ? WHERE id = 1",
        (CONFIG["sbi_initial_balance"], datetime.now().isoformat())
    )
    conn.execute("DELETE FROM sbi_transactions")
    conn.commit()
    conn.close()
    logger.info(f"💰 SBI Account reset to ₹{CONFIG['sbi_initial_balance']}")
    return {"status": "reset", "balance": CONFIG["sbi_initial_balance"]}


# ============================================================
# BLINKIT API (CARROT) - Virtual Rewards for Productivity
# ============================================================
# ⚠️ DISCLAIMER: This is a FICTIONAL demo for demonstration purposes only.
# No real orders are placed. Blinkit branding used for visual authenticity.

def _generate_order_id() -> str:
    """Generate a fake Blinkit order ID"""
    return f"BLK{random.randint(100000, 999999)}"


def _get_reward_item(tasks_completed: int, total_tasks: int) -> str:
    """Determine reward based on task completion progress"""
    if total_tasks == 0:
        return CONFIG["reward_single_task"]
    
    completion_ratio = tasks_completed / total_tasks
    
    if completion_ratio >= 1.0:
        return CONFIG["reward_all_tasks"]
    elif completion_ratio >= 0.5:
        return CONFIG["reward_half_tasks"]
    else:
        return CONFIG["reward_single_task"]


@app.get("/api/blinkit/orders", response_model=list[BlinkitOrderResponse])
def get_blinkit_orders(limit: int = 20):
    """Get recent Blinkit reward orders (DEMO)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    orders = conn.execute(
        "SELECT * FROM blinkit_orders ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    
    return [BlinkitOrderResponse(
        order_id=o["order_id"],
        item=o["item"],
        status=o["status"],
        reason=o["reason"],
        timestamp=o["timestamp"],
        estimated_delivery="10-15 minutes"
    ) for o in orders]


@app.post("/api/blinkit/reward", response_model=BlinkitRewardResponse)
def place_blinkit_reward(req: BlinkitRewardRequest):
    """
    Place a reward order on Blinkit (DEMO - No real order placed).
    Called when user completes tasks.
    """
    logger.info("")
    logger.info("🛒 BLINKIT REWARD ORDER (DEMO)")
    logger.info("─" * 40)
    
    # Determine reward item
    item = _get_reward_item(req.tasks_completed, req.total_tasks)
    order_id = _generate_order_id()
    
    # Record order
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO blinkit_orders 
           (timestamp, order_id, item, status, reason, tasks_completed, total_tasks)
           VALUES (?, ?, ?, 'PLACED', ?, ?, ?)""",
        (datetime.now().isoformat(), order_id, item, req.reason, req.tasks_completed, req.total_tasks)
    )
    conn.commit()
    conn.close()
    
    logger.info(f"  Order ID: {order_id}")
    logger.info(f"  Item: {item}")
    logger.info(f"  Progress: {req.tasks_completed}/{req.total_tasks} tasks")
    logger.info(f"  Reason: {req.reason}")
    logger.info("─" * 40)
    
    order = BlinkitOrderResponse(
        order_id=order_id,
        item=item,
        status="PLACED",
        reason=req.reason,
        timestamp=datetime.now().isoformat(),
        estimated_delivery="10-15 minutes"
    )
    
    return BlinkitRewardResponse(
        success=True,
        order=order,
        message=f"🎉 Reward ordered: {item}! Estimated delivery: 10-15 minutes"
    )


@app.post("/api/blinkit/reset")
def reset_blinkit_orders():
    """Clear all Blinkit orders (for demo purposes)"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM blinkit_orders")
    conn.commit()
    conn.close()
    logger.info("🛒 Blinkit orders cleared")
    return {"status": "reset"}


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
    
    # Reset strike count if ≤3 in this 30-min window, else keep accumulating
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    strike_row = conn.execute("SELECT strike_count, window_start FROM focus_strikes WHERE id = 1").fetchone()
    current_strikes = strike_row["strike_count"] if strike_row else 0
    
    if current_strikes <= 3:
        # Good behavior - reset strikes and start new window
        conn.execute(
            "UPDATE focus_strikes SET strike_count = 0, window_start = ?, updated_at = ? WHERE id = 1",
            (datetime.now().isoformat(), datetime.now().isoformat())
        )
        logger.info(f"  Strikes: {current_strikes}/3 in window → RESET (good behavior)")
    else:
        # Bad behavior - keep strikes, just update window_start for next period
        conn.execute(
            "UPDATE focus_strikes SET window_start = ?, updated_at = ? WHERE id = 1",
            (datetime.now().isoformat(), datetime.now().isoformat())
        )
        logger.info(f"  Strikes: {current_strikes}/3 in window → KEPT (needs improvement)")
    
    conn.commit()
    conn.close()
    
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
    
    IMPORTANT: Will not create new interjections if one is already pending (prevents overlap)
    """
    start = time.perf_counter()
    
    # Check for pending interjection FIRST - skip if one is active
    if _has_pending_interjection():
        logger.info("")
        logger.info("👔 MANAGER AGENT (SKIPPED)")
        logger.info("─" * 40)
        logger.info("  ⏸️  Interjection already pending - skipping to prevent overlap")
        logger.info("─" * 40)
        return ManagerResponse(
            is_productive=True,  # Don't trigger anything
            reasoning="Skipped: interjection already in progress",
            interjection=False,
            interjection_message=None,
            strike_count=0,
            mood="cool",
            tasks_updated=[],
            elapsed_ms=round((time.perf_counter() - start) * 1000, 1)
        )
    
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
    
    # Handle interjection: get/increment strike (capped at 3), save pending
    # Double-check for pending interjection to prevent race conditions
    strike_count = 0
    penalty_amount = None
    balance_before = None
    balance_after = None
    if interjection and interjection_message:
        # Race condition check: verify no pending interjection before creating one
        if _has_pending_interjection():
            logger.info("  ⏸️  Interjection blocked: another is already pending")
            interjection = False
            interjection_message = None
        else:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT strike_count FROM focus_strikes WHERE id = 1").fetchone()
            current = (row["strike_count"] if row else 0)
            strike_count = min(3, current + 1)  # Cap at 3
            conn.execute(
                "UPDATE focus_strikes SET strike_count = ?, updated_at = ? WHERE id = 1",
                (strike_count, datetime.now().isoformat())
            )
            conn.execute(
                "INSERT INTO pending_interjections (timestamp, message, acknowledged) VALUES (?, ?, 0)",
                (datetime.now().isoformat(), interjection_message)
            )
            conn.commit()
            conn.close()
            logger.info("")
            logger.info("🚨 " + "=" * 36 + " 🚨")
            logger.info("🚨        INTERJECTION            🚨")
            logger.info("🚨 " + "=" * 36 + " 🚨")
            logger.info(f"   Strike {strike_count}/3: {interjection_message}")
            logger.info("🚨 " + "=" * 36 + " 🚨")
            logger.info("")
            
            # 💸 STICK: Deduct penalty from SBI Bank account
            # Get balance BEFORE penalty for display
            conn_bal = sqlite3.connect(DB_PATH)
            conn_bal.row_factory = sqlite3.Row
            bal_row = conn_bal.execute("SELECT balance FROM sbi_account WHERE id = 1").fetchone()
            balance_before = bal_row["balance"] if bal_row else CONFIG["sbi_initial_balance"]
            conn_bal.close()
            
            try:
                penalty_result = deduct_sbi_penalty(SBIPenaltyRequest(
                    strike_count=strike_count,
                    reason=f"Strike {strike_count}: {interjection_message[:50]}..."
                ))
                penalty_amount = penalty_result.amount_deducted
                balance_after = penalty_result.new_balance
                logger.info(f"  💸 SBI Penalty: ₹{penalty_amount} deducted (₹{balance_before} → ₹{balance_after})")
            except Exception as e:
                logger.error(f"  💸 SBI Penalty failed: {e}")
                penalty_amount = None
                balance_after = None
    
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
    
    # Determine mood for character display
    mood = _get_mood(
        strike_count=strike_count if interjection else 0,
        is_productive=is_productive,
        tasks_completed=len(tasks_updated) > 0
    )
    
    return ManagerResponse(
        is_productive=is_productive,
        reasoning=reasoning,
        interjection=interjection,
        interjection_message=interjection_message,
        strike_count=strike_count if interjection else 0,
        mood=mood,
        tasks_updated=tasks_updated,
        elapsed_ms=round(total_time, 1),
        penalty_amount=penalty_amount,
        balance_before=balance_before,
        balance_after=balance_after
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
    strike_row = conn.execute("SELECT strike_count FROM focus_strikes WHERE id = 1").fetchone()
    strike_count = strike_row["strike_count"] if strike_row else 0
    
    conn.close()
    
    if pending:
        mood = _get_mood(strike_count=strike_count, is_productive=False)
        return InterjectionResponse(
            has_interjection=True,
            message=pending["message"],
            timestamp=pending["timestamp"],
            strike_count=strike_count,
            mood=mood
        )
    return InterjectionResponse(has_interjection=False, message=None, timestamp=None, strike_count=None, mood=None)


@app.post("/api/interjection/acknowledge")
def acknowledge_interjection():
    """Acknowledge pending interjections (strikes are NOT reset - only compaction resets them)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("UPDATE pending_interjections SET acknowledged = 1 WHERE acknowledged = 0")
    # Get current strike count for response (but don't reset it)
    row = conn.execute("SELECT strike_count FROM focus_strikes WHERE id = 1").fetchone()
    strike_count = row["strike_count"] if row else 0
    conn.commit()
    conn.close()
    return {"status": "acknowledged", "strike_count": strike_count}


# ============================================================
# Interjection TTS + voice response + task assessment
# ============================================================

# Tone escalation: strike 1 = gentle, 2 = firm, 3+ = stern (no voice input, just redirect)
# TTS with PENALTY NARRATION - let the user know money is being deducted!
def _interjection_script(message: str, strike_count: int, penalty_amount: float | None = None, balance_after: float | None = None) -> str:
    strike_count = max(1, min(3, strike_count))  # Cap at 3
    
    # Build penalty narration
    penalty_text = ""
    if penalty_amount and balance_after is not None:
        penalty_text = f" I'm deducting {int(penalty_amount)} rupees from your bank account as a penalty. Your new balance is {int(balance_after)} rupees."
    
    if strike_count == 1:
        return f"Hey, I noticed you're distracted. {message}{penalty_text} This is your first warning. Tell me, what tasks have you completed so far?"
    elif strike_count == 2:
        return f"This is your second warning. {message}{penalty_text} You're losing money every time you get distracted. Which tasks have you finished? Get back to work."
    else:  # strike_count >= 3 - stern, no voice input requested
        return f"Strike three. That's it.{penalty_text} I've had enough. You need to stop wasting time and get back to work immediately. No more excuses. Go. Now."


def _strike_label(strike_count: int) -> str:
    """Return human-readable strictness label for logging."""
    if strike_count <= 1:
        return "gentle"
    elif strike_count == 2:
        return "firm"
    else:
        return "stern (force redirect)"


def _get_mood(strike_count: int, is_productive: bool = False, tasks_completed: bool = False) -> str:
    """
    Determine manager mood for character display.
    - happy: user is productive or just completed tasks
    - cool: gentle reminder (strike 1)
    - sad: disappointed, no progress (strike 2)
    - angry: stern enforcement (strike 3+)
    """
    if tasks_completed or (is_productive and strike_count == 0):
        return "happy"
    if strike_count >= 3:
        return "angry"
    if strike_count == 2:
        return "sad"
    return "cool"  # strike 1 or default


def _has_pending_interjection() -> bool:
    """Check if there's an unacknowledged interjection (prevents overlapping interjections)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    pending = conn.execute(
        "SELECT COUNT(*) as count FROM pending_interjections WHERE acknowledged = 0"
    ).fetchone()
    conn.close()
    return pending["count"] > 0 if pending else False


@app.get("/api/strike-status", response_model=StrikeStatusResponse)
def get_strike_status():
    """Get current strike count and whether we're in force-redirect mode"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT strike_count, window_start FROM focus_strikes WHERE id = 1").fetchone()
    conn.close()
    
    strike_count = row["strike_count"] if row else 0
    window_start = row["window_start"] if row else datetime.now().isoformat()
    
    return StrikeStatusResponse(
        strike_count=strike_count,
        window_start=window_start,
        is_force_redirect_mode=strike_count >= 3
    )


@app.post("/api/interjection-speech")
def interjection_speech(req: InterjectionSpeechRequest):
    """Generate TTS audio for interjection message with strike-based tone and penalty narration. Returns MP3."""
    strike_count = max(1, min(3, req.strike_count))  # Cap at 3
    logger.info("")
    logger.info("🔊 TTS INTERJECTION")
    logger.info("─" * 40)
    logger.info(f"  Strike: {strike_count}/3 ({_strike_label(strike_count)})")
    logger.info(f"  Message: {req.message[:80]}..." if len(req.message) > 80 else f"  Message: {req.message}")
    if req.penalty_amount:
        logger.info(f"  💸 Penalty: ₹{req.penalty_amount} | Balance: ₹{req.balance_after}")
    logger.info("─" * 40)
    script = _interjection_script(req.message, strike_count, req.penalty_amount, req.balance_after)
    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=script,
            response_format="mp3",
        )
        audio_bytes = response.content
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _non_compliance_script(strike_count: int, tasks_remaining: int) -> str:
    """Generate escalating TTS message for non-compliant developer - SUCCINCT"""
    strike_count = max(1, min(10, strike_count))  # Allow higher for repeated non-compliance
    tasks_text = f"{tasks_remaining} tasks left." if tasks_remaining > 0 else ""
    
    if strike_count <= 2:
        return f"No progress reported. {tasks_text} Get back to work."
    elif strike_count <= 4:
        return f"Still no progress. {tasks_text} Stop wasting time. Focus now."
    else:
        return f"Unacceptable. {tasks_text} I'm forcing you back to work. No excuses."


@app.post("/api/non-compliance-speech")
def non_compliance_speech(req: NonComplianceSpeechRequest):
    """Generate escalating TTS for non-compliant developer. Returns MP3."""
    logger.info("")
    logger.info("🚨 NON-COMPLIANCE TTS")
    logger.info("─" * 40)
    logger.info(f"  Strike: {req.strike_count} | Tasks remaining: {req.tasks_remaining}")
    logger.info("─" * 40)
    
    script = _non_compliance_script(req.strike_count, req.tasks_remaining)
    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice="nova",
            input=script,
            response_format="mp3",
        )
        audio_bytes = response.content
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"Non-compliance TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe")
def transcribe_audio(file: UploadFile = File(...)):
    """Transcribe user voice response (e.g. progress update). Returns { text }."""
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Expected an audio file")
    try:
        # OpenAI expects a file-like object; ensure we have bytes
        contents = file.file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty audio file")
        audio_file = io.BytesIO(contents)
        audio_file.name = file.filename or "audio.webm"
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text",
        )
        text = transcript if isinstance(transcript, str) else getattr(transcript, "text", "") or ""
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcribe failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _strip_task_prefix(s: str) -> str:
    """Strip '[ ] ' or '[x] ' prefix so we match plain task text in DB."""
    s = (str(s) if s is not None else "").strip()
    for prefix in ("[x] ", "[ ] ", "[x]", "[ ]"):
        if s.startswith(prefix):
            s = s[len(prefix) :].strip()
            break
    return s


@app.post("/api/assess-task-completion", response_model=AssessTaskCompletionResponse)
def assess_task_completion(req: AssessTaskCompletionRequest):
    """From user's voice transcript, determine which tasks to mark done and assess compliance."""
    pending_tasks = [t for t in req.task_list if not t.done]
    
    if not req.transcript.strip():
        return AssessTaskCompletionResponse(
            tasks_to_complete=[],
            is_compliant=False,
            compliance_message="No response detected"
        )
    
    # Build numbered task list for clearer LLM matching
    task_entries = []
    for i, t in enumerate(req.task_list, 1):
        status = "[DONE]" if t.done else "[PENDING]"
        task_entries.append(f"{i}. {status} {t.text}")
    tasks_str = "\n".join(task_entries) if task_entries else "No tasks"
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """You are assessing a developer's spoken progress report.

IMPORTANT: The developer is telling you which tasks they have ALREADY FINISHED (past tense).
You must identify ONLY the tasks they explicitly claim to have completed.

Given the numbered task list and the user's transcript, determine:
1. Which specific tasks (by number) they said they have ALREADY COMPLETED
2. Whether they are being cooperative (compliant) or making excuses (non-compliant)

Respond in JSON:
{
  "completed_task_numbers": [1, 3, ...],
  "is_compliant": true/false,
  "compliance_reason": "brief explanation"
}

Rules for "completed_task_numbers":
- ONLY include tasks the user EXPLICITLY said they finished/completed/done
- Do NOT include tasks they say they "will do" or "are working on"
- Do NOT include tasks just because the user mentions them
- If user says "I haven't done anything" or refuses, return empty array []
- If user mentions completing a task, include its NUMBER from the list

Rules for "is_compliant":
- TRUE if: they report completing tasks, OR acknowledge work remaining, OR commit to work
- FALSE if: they refuse, make excuses, are dismissive, or won't engage""",
            },
            {
                "role": "user",
                "content": f"Task list:\n{tasks_str}\n\nDeveloper said: \"{req.transcript}\"",
            },
        ],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content
    result = json.loads(raw)
    
    logger.info(f"[Assessment] LLM response: {raw}")
    
    completed_task_numbers = result.get("completed_task_numbers", [])
    is_compliant = result.get("is_compliant", True)
    compliance_reason = result.get("compliance_reason", "")
    
    if not isinstance(completed_task_numbers, list):
        completed_task_numbers = []
    
    # Convert task numbers to task text (1-indexed)
    tasks_to_complete = []
    for num in completed_task_numbers:
        try:
            idx = int(num) - 1  # Convert to 0-indexed
            if 0 <= idx < len(req.task_list):
                task = req.task_list[idx]
                if not task.done:  # Only mark if not already done
                    tasks_to_complete.append(task.text)
        except (ValueError, TypeError):
            continue
    
    logger.info(f"[Assessment] Task numbers: {completed_task_numbers} -> Tasks to mark done: {tasks_to_complete}")
    
    # Mark those tasks done in DB using EXACT match
    if tasks_to_complete:
        conn = sqlite3.connect(DB_PATH)
        for task_text in tasks_to_complete:
            # Use exact match, not LIKE
            conn.execute(
                "UPDATE tasks SET done = 1 WHERE text = ? AND done = 0",
                (task_text,)
            )
        conn.commit()
        conn.close()
    
    # Determine compliance message
    if tasks_to_complete:
        compliance_message = f"Completed {len(tasks_to_complete)} task(s)"
        is_compliant = True  # If they completed tasks, they're compliant
        
        # 🎁 CARROT: Order Blinkit reward for task completion!
        total_tasks = len(req.task_list)
        completed_now = len(tasks_to_complete)
        already_done = len([t for t in req.task_list if t.done])
        total_completed = already_done + completed_now
        
        try:
            reward_result = place_blinkit_reward(BlinkitRewardRequest(
                tasks_completed=total_completed,
                total_tasks=total_tasks,
                reason=f"Completed {completed_now} task(s): {', '.join(tasks_to_complete[:2])}{'...' if len(tasks_to_complete) > 2 else ''}"
            ))
            logger.info(f"  🎁 Blinkit Reward: {reward_result.order.item if reward_result.order else 'None'}")
            compliance_message += f" 🎁 Reward ordered: {reward_result.order.item if reward_result.order else 'None'}"
        except Exception as e:
            logger.error(f"  🎁 Blinkit Reward failed: {e}")
            
    elif not is_compliant and len(pending_tasks) > 0:
        compliance_message = compliance_reason or "No progress reported on pending tasks"
    else:
        compliance_message = compliance_reason or "Response acknowledged"
    
    logger.info(f"[Assessment] Final: Compliant={is_compliant} | Completed={len(tasks_to_complete)} | Reason={compliance_message}")
    
    return AssessTaskCompletionResponse(
        tasks_to_complete=tasks_to_complete,
        is_compliant=is_compliant,
        compliance_message=compliance_message
    )


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
    """Clear observation history only (keeps tasks, bank, orders)"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM observations")
    conn.execute("DELETE FROM compactions")
    conn.execute("DELETE FROM manager_decisions")
    conn.execute("DELETE FROM pending_interjections")
    conn.execute(
        "UPDATE focus_strikes SET strike_count = 0, window_start = ?, updated_at = ? WHERE id = 1",
        (datetime.now().isoformat(), datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    logger.info("Observation history cleared")
    return {"status": "cleared"}


@app.delete("/api/reset-all")
def reset_all_data():
    """
    FULL RESET - Clear ALL data and start fresh:
    - Tasks
    - Observations & Compactions
    - Manager decisions
    - Interjections & Strikes
    - SBI Bank (reset to initial balance)
    - Blinkit orders
    """
    conn = sqlite3.connect(DB_PATH)
    
    # Clear all tables
    conn.execute("DELETE FROM tasks")
    conn.execute("DELETE FROM observations")
    conn.execute("DELETE FROM compactions")
    conn.execute("DELETE FROM manager_decisions")
    conn.execute("DELETE FROM pending_interjections")
    conn.execute("DELETE FROM sbi_transactions")
    conn.execute("DELETE FROM blinkit_orders")
    
    # Reset focus strikes
    conn.execute(
        "UPDATE focus_strikes SET strike_count = 0, window_start = ?, updated_at = ? WHERE id = 1",
        (datetime.now().isoformat(), datetime.now().isoformat())
    )
    
    # Reset SBI Bank to initial balance
    conn.execute(
        "UPDATE sbi_account SET balance = ?, updated_at = ? WHERE id = 1",
        (CONFIG["sbi_initial_balance"], datetime.now().isoformat())
    )
    
    conn.commit()
    conn.close()
    
    logger.info("")
    logger.info("🔄 " + "=" * 36 + " 🔄")
    logger.info("🔄        FULL DATA RESET           🔄")
    logger.info("🔄 " + "=" * 36 + " 🔄")
    logger.info(f"  ✓ Tasks cleared")
    logger.info(f"  ✓ Observations cleared")
    logger.info(f"  ✓ Manager decisions cleared")
    logger.info(f"  ✓ Strikes reset to 0")
    logger.info(f"  ✓ SBI Bank reset to ₹{CONFIG['sbi_initial_balance']}")
    logger.info(f"  ✓ Blinkit orders cleared")
    logger.info("🔄 " + "=" * 36 + " 🔄")
    
    return {
        "status": "reset",
        "message": "All data cleared. Fresh start!",
        "sbi_balance": CONFIG["sbi_initial_balance"]
    }


# ============================================================
# Local Window Control (macOS)
# ============================================================

def run_applescript(script: str) -> bool:
    """Run AppleScript on macOS"""
    if platform.system() != "Darwin":
        logger.warning("Window control only supported on macOS")
        return False
    try:
        subprocess.run(["osascript", "-e", script], check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"AppleScript failed: {e}")
        return False


@app.post("/api/focus-browser")
def focus_browser():
    """
    Focus the browser window AND switch to the Productivity Assistant tab.
    Called when interjection is triggered in local mode.
    """
    logger.info("")
    logger.info("🪟 FOCUS BROWSER (Local Mode)")
    logger.info("─" * 40)
    
    # Chrome: Activate and switch to localhost:3000 tab
    chrome_script = '''
        tell application "Google Chrome"
            activate
            set targetURL to "localhost:3000"
            set foundTab to false
            
            repeat with w in windows
                set tabIndex to 1
                repeat with t in tabs of w
                    if URL of t contains targetURL then
                        set active tab index of w to tabIndex
                        set index of w to 1
                        set foundTab to true
                        return "found"
                    end if
                    set tabIndex to tabIndex + 1
                end repeat
            end repeat
            
            return "not_found"
        end tell
    '''
    
    # Arc: Similar approach
    arc_script = '''
        tell application "Arc"
            activate
            set targetURL to "localhost:3000"
            
            repeat with w in windows
                repeat with t in tabs of w
                    if URL of t contains targetURL then
                        tell t to select
                        return "found"
                    end if
                end repeat
            end repeat
            
            return "not_found"
        end tell
    '''
    
    # Safari
    safari_script = '''
        tell application "Safari"
            activate
            set targetURL to "localhost:3000"
            
            repeat with w in windows
                set tabIndex to 1
                repeat with t in tabs of w
                    if URL of t contains targetURL then
                        set current tab of w to t
                        set index of w to 1
                        return "found"
                    end if
                    set tabIndex to tabIndex + 1
                end repeat
            end repeat
            
            return "not_found"
        end tell
    '''
    
    browsers = [
        ("Google Chrome", chrome_script),
        ("Arc", arc_script),
        ("Safari", safari_script),
    ]
    
    for browser_name, script in browsers:
        # Check if browser is running
        check_script = f'''
            tell application "System Events"
                if (name of processes) contains "{browser_name}" then
                    return "running"
                end if
            end tell
            return "not running"
        '''
        try:
            result = subprocess.run(
                ["osascript", "-e", check_script],
                capture_output=True, text=True
            )
            if "running" in result.stdout:
                # Try to find and switch to the tab
                tab_result = subprocess.run(
                    ["osascript", "-e", script],
                    capture_output=True, text=True
                )
                if "found" in tab_result.stdout:
                    logger.info(f"  Activated: {browser_name}")
                    logger.info(f"  Switched to: localhost:3000 tab")
                    logger.info("─" * 40)
                    return {"status": "focused", "app": browser_name, "tab_found": True}
                else:
                    # Tab not found but browser activated
                    logger.info(f"  Activated: {browser_name}")
                    logger.info(f"  Tab not found (localhost:3000)")
                    logger.info("─" * 40)
                    return {"status": "focused", "app": browser_name, "tab_found": False}
        except Exception as e:
            logger.error(f"  Failed with {browser_name}: {e}")
            continue
    
    logger.info("  No supported browser found running")
    logger.info("─" * 40)
    return {"status": "no_browser", "app": None, "tab_found": False}


@app.post("/api/focus-productive-app")
def focus_productive_app():
    """
    Focus a productive app (Cursor, VS Code, Terminal, etc.)
    Called when user acknowledges interjection in local mode.
    """
    logger.info("")
    logger.info("🪟 FOCUS PRODUCTIVE APP (Local Mode)")
    logger.info("─" * 40)
    
    # Priority list of productive apps
    productive_apps = [
        "Cursor",
        "Code",  # VS Code
        "Visual Studio Code",
        "Terminal",
        "iTerm2",
        "Warp",
        "Xcode",
        "IntelliJ IDEA",
        "PyCharm",
        "WebStorm",
    ]
    
    for app in productive_apps:
        check_script = f'''
            tell application "System Events"
                if (name of processes) contains "{app}" then
                    return "running"
                end if
            end tell
            return "not running"
        '''
        try:
            result = subprocess.run(
                ["osascript", "-e", check_script],
                capture_output=True, text=True
            )
            if "running" in result.stdout:
                activate_script = f'''
                    tell application "{app}"
                        activate
                    end tell
                '''
                if run_applescript(activate_script):
                    logger.info(f"  Activated: {app}")
                    logger.info("─" * 40)
                    return {"status": "focused", "app": app}
        except Exception as e:
            logger.error(f"  Failed to check {app}: {e}")
            continue
    
    logger.info("  No productive app found running, staying in browser")
    logger.info("─" * 40)
    return {"status": "no_app", "app": None}


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
