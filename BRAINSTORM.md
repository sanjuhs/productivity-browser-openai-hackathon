# Productivity Browser Assistant - Brainstorm

## Vision
A Google Meet-like browser experience that captures your screen in real-time and uses GPT-4o vision to provide intelligent assistance based on what you're working on.

## Architecture

### Frontend (Next.js + ShadcnUI)
- **Screen Capture**: WebRTC `getDisplayMedia()` API for real-time screen capture
- **Video Stream**: Canvas-based frame extraction → WebSocket/HTTP to backend
- **UI Components**:
  - Daily input text box (brain dump / task entry)
  - Character companion (placeholder for animated assistant)
  - Focus mode task tracker

### Backend (Python + FastAPI)
- **Screenshot Analysis**: GPT-4o vision API for understanding screen context
- **Task Management**: Parse and track focus tasks
- **WebSocket Server**: Real-time bidirectional communication

## Data Flow
```
[Screen Capture] → [Frame Extraction] → [WebSocket] → [Python Backend]
                                                              ↓
                                                      [GPT-4o Vision]
                                                              ↓
                                                      [Context Analysis]
                                                              ↓
                                              [Suggestions/Actions] → [Frontend UI]
```

## Key Features (MVP)

### Phase 1 - Foundation
- [x] Project setup (Next.js + Python backend)
- [x] Screenshot analysis with GPT-4o (timed)
- [x] Basic UI with daily input + character + focus mode

### Phase 2 - Screen Capture
- [ ] Implement `getDisplayMedia()` screen capture
- [ ] Frame extraction at configurable intervals (e.g., 1 frame/5 seconds)
- [ ] WebSocket connection to backend

### Phase 3 - Intelligence
- [ ] Context-aware suggestions based on screen content
- [ ] Focus mode: detect if user is on-task or distracted
- [ ] Smart task extraction from daily input

### Phase 4 - Character Companion
- [ ] Animated character responses
- [ ] Voice feedback (TTS)
- [ ] Personality tuning

## Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, ShadcnUI |
| Backend | Python 3.12, FastAPI, OpenAI SDK |
| APIs | GPT-4o (vision), WebRTC |
| Infra | Local dev → Vercel (FE) + Railway/Fly (BE) |

## Performance Considerations
- Frame extraction: ~100-500ms per frame capture
- GPT-4o vision API: ~2-5s per image analysis
- WebSocket latency: <50ms locally
- Target: ~1 analysis per 5-10 seconds during active use

## Privacy & Security
- Screen capture requires explicit user permission
- All processing can be local-first with cloud fallback
- No persistent storage of screenshots (process and discard)

## Open Questions
1. Optimal frame capture rate for balance between insight and API cost?
2. Character design: 2D sprite, 3D avatar, or abstract visualization?
3. Should focus mode be aggressive (block distractions) or passive (just notify)?
