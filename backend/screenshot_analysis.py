#!/usr/bin/env python3
"""
Screenshot Analysis with GPT-4o Vision
Captures screenshot and analyzes it with timing metrics
"""

import base64
import io
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from PIL import ImageGrab

# Load env from parent directory
load_dotenv(Path(__file__).parent.parent / ".env")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def capture_screenshot() -> tuple[str, float]:
    """Capture screenshot and return base64 encoded image with timing"""
    start = time.perf_counter()
    screenshot = ImageGrab.grab()
    
    # Convert to base64
    buffer = io.BytesIO()
    screenshot.save(buffer, format="PNG", optimize=True)
    base64_image = base64.b64encode(buffer.getvalue()).decode("utf-8")
    
    elapsed = time.perf_counter() - start
    return base64_image, elapsed


def analyze_screenshot(base64_image: str) -> tuple[str, float]:
    """Send screenshot to GPT-4o for analysis with timing"""
    start = time.perf_counter()
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Analyze this screenshot. What is the user working on? Provide a brief, helpful summary in 2-3 sentences. Focus on the main application and task visible."
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}",
                            "detail": "low"  # Use low detail for faster processing
                        }
                    }
                ]
            }
        ],
        max_tokens=150
    )
    
    elapsed = time.perf_counter() - start
    return response.choices[0].message.content, elapsed


def main():
    print("=" * 60)
    print("Screenshot Analysis with GPT-4o Vision")
    print("=" * 60)
    
    # Capture screenshot
    print("\n[1] Capturing screenshot...")
    base64_image, capture_time = capture_screenshot()
    print(f"    Screenshot captured in {capture_time*1000:.1f}ms")
    print(f"    Image size: {len(base64_image) / 1024:.1f}KB (base64)")
    
    # Analyze with GPT-4o
    print("\n[2] Sending to GPT-4o for analysis...")
    analysis, api_time = analyze_screenshot(base64_image)
    print(f"    API response received in {api_time*1000:.1f}ms")
    
    # Results
    print("\n" + "=" * 60)
    print("ANALYSIS RESULT")
    print("=" * 60)
    print(analysis)
    
    # Timing summary
    total_time = capture_time + api_time
    print("\n" + "-" * 60)
    print("TIMING SUMMARY")
    print("-" * 60)
    print(f"  Screenshot capture: {capture_time*1000:>8.1f}ms")
    print(f"  GPT-4o API call:    {api_time*1000:>8.1f}ms")
    print(f"  Total:              {total_time*1000:>8.1f}ms")
    print("-" * 60)


if __name__ == "__main__":
    main()
