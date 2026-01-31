"""
FastAPI Backend for Productivity Browser Assistant
- RapidOCR for text extraction
- GPT-4o for vision analysis (fallback)
- SQLite for analysis history + summaries
"""

import base64
import io
import json
import logging
import os
import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from PIL import Image
from pydantic import BaseModel
from rapidocr import RapidOCR

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("productivity")

load_dotenv(Path(__file__).parent.parent / ".env")

# ============================================================
# CONFIGURATION - Change these values as needed
# ============================================================
CONFIG = {
    "analysis_interval_seconds": 2,      # How often to analyze (frontend will read this)
    "summary_interval_seconds": 180,     # Generate summary every 3 minutes
    "analyses_before_summary": 10,       # Number of analyses to consider for summary
    "context_analyses_count": 5,         # How many recent analyses to include as context
}
# ============================================================

# Initialize OCR engine
logger.info("Initializing RapidOCR engine...")
ocr_engine = RapidOCR()
logger.info("RapidOCR ready")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

DB_PATH = Path(__file__).parent / "productivity.db"


def init_db():
    """Initialize SQLite database"""
    conn = sqlite3.connect(DB_PATH)
    
    # Analysis history table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS analysis_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            ocr_text TEXT,
            analysis TEXT,
            thought TEXT,
            is_focused INTEGER,
            method TEXT,
            elapsed_ms REAL
        )
    """)
    
    # Summaries table - periodic summaries of user activity
    conn.execute("""
        CREATE TABLE IF NOT EXISTS activity_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            summary TEXT NOT NULL,
            analyses_count INTEGER,
            period_start TEXT,
            period_end TEXT
        )
    """)
    
    conn.commit()
    conn.close()
    logger.info(f"Database initialized at {DB_PATH}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Productivity Browser Assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BrainDumpRequest(BaseModel):
    text: str


class ScreenAnalysisRequest(BaseModel):
    image_base64: str
    current_tasks: list[str] = []


class TasksResponse(BaseModel):
    tasks: list[str]
    analysis: str
    elapsed_ms: float


class ScreenAnalysisResponse(BaseModel):
    analysis: str
    thought: str
    is_focused: bool
    tasks_to_complete: list[str]
    ocr_text: str | None
    method: str  # "ocr" or "vision"
    elapsed_ms: float


class HistoryItem(BaseModel):
    id: int
    timestamp: str
    analysis: str
    thought: str
    is_focused: bool
    method: str


class SummaryItem(BaseModel):
    id: int
    timestamp: str
    summary: str
    analyses_count: int


class ConfigResponse(BaseModel):
    analysis_interval_seconds: int
    summary_interval_seconds: int


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/config", response_model=ConfigResponse)
def get_config():
    """Get configuration values for frontend"""
    return ConfigResponse(
        analysis_interval_seconds=CONFIG["analysis_interval_seconds"],
        summary_interval_seconds=CONFIG["summary_interval_seconds"]
    )


@app.post("/api/analyze-braindump", response_model=TasksResponse)
def analyze_braindump(req: BrainDumpRequest):
    """Analyze brain dump text and extract actionable tasks"""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    logger.info(f"Brain dump analysis: {len(req.text)} chars")
    start = time.perf_counter()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """You are a productivity assistant. Analyze the user's brain dump and extract clear, actionable tasks.

Rules:
- Extract 3-7 concrete tasks from the text
- Each task should be specific and actionable (start with a verb)
- Keep tasks concise (under 10 words each)
- Also provide a 1-sentence analysis of their focus areas

Respond in JSON format:
{"tasks": ["task1", "task2", ...], "analysis": "brief analysis"}"""
            },
            {"role": "user", "content": req.text}
        ],
        response_format={"type": "json_object"},
        max_tokens=300
    )

    elapsed = (time.perf_counter() - start) * 1000
    result = json.loads(response.choices[0].message.content)
    
    logger.info(f"Brain dump: extracted {len(result.get('tasks', []))} tasks in {elapsed:.0f}ms")

    return TasksResponse(
        tasks=result.get("tasks", []),
        analysis=result.get("analysis", ""),
        elapsed_ms=round(elapsed, 1)
    )


def decode_image(image_base64: str) -> Image.Image:
    """Decode base64 image to PIL Image"""
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    image_base64 = re.sub(r'\s+', '', image_base64)
    image_bytes = base64.b64decode(image_base64)
    return Image.open(io.BytesIO(image_bytes))


def run_ocr(image: Image.Image) -> tuple[str, float]:
    """Run RapidOCR on image and return extracted text with timing"""
    start = time.perf_counter()
    
    img_array = np.array(image.convert("RGB"))
    result = ocr_engine(img_array)
    
    elapsed = (time.perf_counter() - start) * 1000
    
    if result is None or result.txts is None:
        logger.info(f"[OCR] No text found ({elapsed:.0f}ms)")
        return "", elapsed
    
    text = " ".join(result.txts)
    logger.info(f"[OCR] Extracted {len(text)} chars, {len(result.txts)} segments ({elapsed:.0f}ms)")
    
    # Print the actual OCR text for debugging
    logger.info("=" * 40)
    logger.info("[OCR TEXT EXTRACTED]:")
    logger.info(text[:500] + ("..." if len(text) > 500 else ""))
    logger.info("=" * 40)
    
    return text, elapsed


def get_recent_context() -> str:
    """Get recent analyses and last summary for context"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Get last summary
    last_summary = conn.execute(
        "SELECT summary, timestamp FROM activity_summaries ORDER BY id DESC LIMIT 1"
    ).fetchone()
    
    # Get analyses since last summary (or last N if no summary)
    if last_summary:
        analyses = conn.execute(
            """SELECT analysis, is_focused, timestamp FROM analysis_history 
               WHERE timestamp > ? ORDER BY id DESC LIMIT ?""",
            (last_summary["timestamp"], CONFIG["context_analyses_count"])
        ).fetchall()
    else:
        analyses = conn.execute(
            "SELECT analysis, is_focused, timestamp FROM analysis_history ORDER BY id DESC LIMIT ?",
            (CONFIG["context_analyses_count"],)
        ).fetchall()
    
    conn.close()
    
    context_parts = []
    
    if last_summary:
        context_parts.append(f"[Previous Summary ({last_summary['timestamp']})]: {last_summary['summary']}")
    
    if analyses:
        context_parts.append("[Recent Activity]:")
        for a in reversed(analyses):  # Oldest first
            status = "✓ focused" if a["is_focused"] else "✗ distracted"
            context_parts.append(f"  - {a['timestamp']}: {status} - {a['analysis'][:100]}")
    
    return "\n".join(context_parts) if context_parts else ""


def analyze_with_ocr_text(ocr_text: str, current_tasks: list[str], context: str) -> tuple[dict, float]:
    """Use LLM to analyze productivity based on OCR text"""
    start = time.perf_counter()
    
    tasks_context = f"\nUser's current tasks: {', '.join(current_tasks)}" if current_tasks else ""
    history_context = f"\n\n{context}" if context else ""
    
    logger.info(f"[GPT-4o-mini] Analyzing OCR text ({len(ocr_text)} chars)...")
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """You are a productivity companion analyzing what a user is working on based on text extracted from their screen.

Determine:
1. What they're working on (2-3 sentences)
2. If they're focused/productive or distracted
3. A short, friendly thought/comment (encouraging if focused, gentle nudge if distracted)
4. Check if any tasks from their list appear to be completed based on what you see

DO NOT suggest new tasks - only identify if existing tasks are completed.

Respond in JSON:
{
  "analysis": "2-3 sentence description of current activity",
  "is_focused": true/false,
  "thought": "short friendly comment",
  "tasks_to_complete": ["exact task text from their list that appears done"] or [],
  "confidence": "high/medium/low"
}

If confidence is "low", we'll fall back to vision analysis."""
            },
            {"role": "user", "content": f"Screen text:\n{ocr_text}{tasks_context}{history_context}"}
        ],
        response_format={"type": "json_object"},
        max_tokens=400
    )
    
    elapsed = (time.perf_counter() - start) * 1000
    result = json.loads(response.choices[0].message.content)
    
    logger.info(f"[GPT-4o-mini] Result: focused={result.get('is_focused')}, confidence={result.get('confidence')} ({elapsed:.0f}ms)")
    
    return result, elapsed


def analyze_with_vision(image_base64: str, current_tasks: list[str], context: str) -> tuple[dict, float]:
    """Use GPT-4o vision to analyze screenshot"""
    start = time.perf_counter()
    
    tasks_context = f"\nUser's current tasks: {', '.join(current_tasks)}" if current_tasks else ""
    history_context = f"\n\n{context}" if context else ""
    
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    image_base64 = re.sub(r'\s+', '', image_base64)
    
    logger.info("[GPT-4o Vision] Analyzing screenshot...")
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"""Analyze this screenshot. What is the user working on?{tasks_context}{history_context}

DO NOT suggest new tasks - only identify if existing tasks from the user's list appear completed.

Respond in JSON:
{{
  "analysis": "2-3 sentence description of what user is doing",
  "is_focused": true/false based on whether they seem productive,
  "thought": "short friendly comment (encouraging or gentle nudge)",
  "tasks_to_complete": ["exact task text that appears done"] or []
}}"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_base64}",
                            "detail": "low"
                        }
                    }
                ]
            }
        ],
        response_format={"type": "json_object"},
        max_tokens=400
    )
    
    elapsed = (time.perf_counter() - start) * 1000
    result = json.loads(response.choices[0].message.content)
    
    logger.info(f"[GPT-4o Vision] Result: focused={result.get('is_focused')} ({elapsed:.0f}ms)")
    
    return result, elapsed


def save_analysis(
    ocr_text: str | None,
    analysis: str,
    thought: str,
    is_focused: bool,
    method: str,
    elapsed_ms: float
):
    """Save analysis to SQLite"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO analysis_history 
           (timestamp, ocr_text, analysis, thought, is_focused, method, elapsed_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            datetime.now().isoformat(),
            ocr_text,
            analysis,
            thought,
            1 if is_focused else 0,
            method,
            elapsed_ms
        )
    )
    conn.commit()
    conn.close()
    logger.info(f"[DB] Saved analysis (method={method})")


@app.post("/api/analyze-screen", response_model=ScreenAnalysisResponse)
def analyze_screen(req: ScreenAnalysisRequest):
    """
    Analyze screenshot using OCR first, fallback to vision if needed.
    Stores results in SQLite.
    """
    total_start = time.perf_counter()
    logger.info("=" * 60)
    logger.info("SCREEN ANALYSIS STARTED")
    logger.info(f"Current tasks: {req.current_tasks}")
    
    try:
        image = decode_image(req.image_base64)
        logger.info(f"Image decoded: {image.size}")
    except Exception as e:
        logger.error(f"Image decode failed: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid image: {str(e)}")
    
    # Get recent context (summaries + analyses)
    context = get_recent_context()
    if context:
        logger.info(f"[CONTEXT] Using {len(context)} chars of history context")
    
    # Step 1: Run OCR
    ocr_text, ocr_time = run_ocr(image)
    method = "ocr"
    
    # Step 2: Analyze based on OCR text if we got enough
    if len(ocr_text) > 50:
        result, llm_time = analyze_with_ocr_text(ocr_text, req.current_tasks, context)
        
        if result.get("confidence") == "low":
            logger.info("[FALLBACK] Low confidence from OCR, switching to Vision...")
            result, llm_time = analyze_with_vision(req.image_base64, req.current_tasks, context)
            method = "vision"
    else:
        logger.info(f"[SKIP OCR] Only {len(ocr_text)} chars, using Vision directly...")
        result, llm_time = analyze_with_vision(req.image_base64, req.current_tasks, context)
        method = "vision"
        ocr_text = None
    
    total_elapsed = (time.perf_counter() - total_start) * 1000
    
    analysis = result.get("analysis", "Could not analyze screen")
    thought = result.get("thought", "Keep going!")
    is_focused = result.get("is_focused", True)
    tasks_to_complete = result.get("tasks_to_complete", [])
    
    # Save to database
    save_analysis(
        ocr_text=ocr_text,
        analysis=analysis,
        thought=thought,
        is_focused=is_focused,
        method=method,
        elapsed_ms=round(total_elapsed, 1)
    )
    
    logger.info(f"ANALYSIS COMPLETE: method={method}, focused={is_focused}, total={total_elapsed:.0f}ms")
    logger.info("=" * 60)
    
    return ScreenAnalysisResponse(
        analysis=analysis,
        thought=thought,
        is_focused=is_focused,
        tasks_to_complete=tasks_to_complete,
        ocr_text=ocr_text,
        method=method,
        elapsed_ms=round(total_elapsed, 1)
    )


@app.post("/api/generate-summary", response_model=SummaryItem)
def generate_summary():
    """Generate a summary of recent activity and store it"""
    logger.info("Generating activity summary...")
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Get last summary timestamp
    last_summary = conn.execute(
        "SELECT timestamp FROM activity_summaries ORDER BY id DESC LIMIT 1"
    ).fetchone()
    
    # Get analyses since last summary
    if last_summary:
        analyses = conn.execute(
            """SELECT analysis, is_focused, timestamp FROM analysis_history 
               WHERE timestamp > ? ORDER BY timestamp ASC""",
            (last_summary["timestamp"],)
        ).fetchall()
        period_start = last_summary["timestamp"]
    else:
        analyses = conn.execute(
            "SELECT analysis, is_focused, timestamp FROM analysis_history ORDER BY timestamp ASC"
        ).fetchall()
        period_start = analyses[0]["timestamp"] if analyses else datetime.now().isoformat()
    
    conn.close()
    
    if not analyses:
        raise HTTPException(status_code=400, detail="No analyses to summarize")
    
    # Build summary prompt
    analyses_text = "\n".join([
        f"- [{a['timestamp']}] {'Focused' if a['is_focused'] else 'Distracted'}: {a['analysis']}"
        for a in analyses
    ])
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """Summarize the user's activity over this period in 2-3 concise sentences.
Focus on:
- What they worked on
- Overall productivity level
- Any patterns (focused vs distracted periods)

Be factual and brief. This summary will be used as context for future analysis."""
            },
            {"role": "user", "content": f"Activity log:\n{analyses_text}"}
        ],
        max_tokens=150
    )
    
    summary = response.choices[0].message.content.strip()
    period_end = analyses[-1]["timestamp"]
    
    # Save summary
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute(
        """INSERT INTO activity_summaries 
           (timestamp, summary, analyses_count, period_start, period_end)
           VALUES (?, ?, ?, ?, ?)""",
        (datetime.now().isoformat(), summary, len(analyses), period_start, period_end)
    )
    summary_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    logger.info(f"[SUMMARY] Generated summary for {len(analyses)} analyses")
    logger.info(f"[SUMMARY] {summary}")
    
    return SummaryItem(
        id=summary_id,
        timestamp=datetime.now().isoformat(),
        summary=summary,
        analyses_count=len(analyses)
    )


@app.get("/api/history", response_model=list[HistoryItem])
def get_history(limit: int = 50):
    """Get recent analysis history"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, timestamp, analysis, thought, is_focused, method FROM analysis_history ORDER BY id DESC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    
    return [
        HistoryItem(
            id=row["id"],
            timestamp=row["timestamp"],
            analysis=row["analysis"],
            thought=row["thought"],
            is_focused=bool(row["is_focused"]),
            method=row["method"]
        )
        for row in rows
    ]


@app.get("/api/summaries", response_model=list[SummaryItem])
def get_summaries(limit: int = 20):
    """Get recent activity summaries"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, timestamp, summary, analyses_count FROM activity_summaries ORDER BY id DESC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    
    return [
        SummaryItem(
            id=row["id"],
            timestamp=row["timestamp"],
            summary=row["summary"],
            analyses_count=row["analyses_count"]
        )
        for row in rows
    ]


@app.delete("/api/history")
def clear_history():
    """Clear all analysis history and summaries"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM analysis_history")
    conn.execute("DELETE FROM activity_summaries")
    conn.commit()
    conn.close()
    logger.info("[DB] History and summaries cleared")
    return {"status": "cleared"}


# Keep old endpoint for backwards compatibility
@app.post("/api/analyze-screenshot", response_model=ScreenAnalysisResponse)
def analyze_screenshot_legacy(req: ScreenAnalysisRequest):
    """Legacy endpoint - redirects to new analyze-screen"""
    return analyze_screen(req)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
