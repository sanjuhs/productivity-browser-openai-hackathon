"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Target,
  Brain,
  CheckCircle2,
  Circle,
  Monitor,
  MonitorOff,
  Loader2,
  Sun,
  Moon,
  Video,
  VideoOff,
  Play,
  Pause,
  AlertTriangle,
  Laptop,
  Mic,
  MicOff,
  Volume2,
  Settings,
  Trash2,
  RefreshCw,
  X,
  Banknote,
  ShoppingBag,
} from "lucide-react";

const API_URL = "http://localhost:8000";

interface Task {
  id: number;
  text: string;
  done: boolean;
}

export default function Home() {
  const [darkMode, setDarkMode] = useState(false);
  const [dailyInput, setDailyInput] = useState("");
  const [newTask, setNewTask] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [localMode, setLocalMode] = useState(true); // Local mode ON by default
  
  // Agent states
  const [observerStatus, setObserverStatus] = useState<string>("Idle");
  const [managerStatus, setManagerStatus] = useState<string>("Idle");
  const [lastObservation, setLastObservation] = useState<string>("");
  const [isProductive, setIsProductive] = useState(true);
  
  // Interjection popup: message, strike (1–3), phase (alert → listening → non-compliance → ready)
  const [interjection, setInterjection] = useState<string | null>(null);
  const [interjectionStrikeCount, setInterjectionStrikeCount] = useState(1);
  const [interjectionPhase, setInterjectionPhase] = useState<"alert" | "listening" | "non-compliance" | "ready">("alert");
  const [managerMood, setManagerMood] = useState<"cool" | "sad" | "angry" | "happy">("cool");
  
  // SBI Bank penalty display
  const [penaltyAmount, setPenaltyAmount] = useState<number | null>(null);
  const [balanceBefore, setBalanceBefore] = useState<number | null>(null);
  const [balanceAfter, setBalanceAfter] = useState<number | null>(null);
  const [showPenaltyAnimation, setShowPenaltyAnimation] = useState(false);
  
  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [sbiBalance, setSbiBalance] = useState<number | null>(null);
  const [blinkitOrderCount, setBlinkitOrderCount] = useState<number>(0);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [screenPermission, setScreenPermission] = useState<"granted" | "prompt" | "unknown">("unknown");
  const [isForceRedirectMode, setIsForceRedirectMode] = useState(false); // True when strikes >= 3
  const [nonComplianceCount, setNonComplianceCount] = useState(0); // Track consecutive non-compliance
  const interjectionActiveRef = useRef(false); // Prevent overlapping interjections
  const interjectionTtsPlayedRef = useRef(false);
  const nonComplianceTtsPlayedRef = useRef(false);
  const ttsPlaybackIdRef = useRef(0); // tie onended to current playback so stale callbacks no-op
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  
  // Agent intervals
  const observerRef = useRef<NodeJS.Timeout | null>(null);
  const managerRef = useRef<NodeJS.Timeout | null>(null);
  const compactionRef = useRef<NodeJS.Timeout | null>(null);
  const autoModeRef = useRef(false); // Track autoMode for callbacks
  const localModeRef = useRef(true); // Track localMode for callbacks
  const titleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const originalTitle = useRef("Multi-Agent Productivity");

  // Check microphone permission status
  const checkMicPermission = useCallback(async (): Promise<"granted" | "denied" | "prompt" | "unknown"> => {
    try {
      // Try Permissions API first (Chrome, Edge)
      if (navigator.permissions?.query) {
        const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
        const status = result.state as "granted" | "denied" | "prompt";
        setMicPermission(status);
        console.log("[Permissions] Mic permission:", status);
        return status;
      }
    } catch {
      // Firefox/Safari don't support microphone query
    }
    // Fallback: try to enumerate devices — if we get labeled devices, permission is granted
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      // If we have labels, permission was previously granted
      const hasLabels = audioInputs.some((d) => d.label);
      if (hasLabels) {
        setMicPermission("granted");
        return "granted";
      }
      // No labels means either prompt or denied — we'll treat as prompt
      setMicPermission("prompt");
      return "prompt";
    } catch {
      setMicPermission("unknown");
      return "unknown";
    }
  }, []);

  // Request microphone permission explicitly
  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    setMicError(null);
    try {
      console.log("[Permissions] Requesting mic permission...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission granted — stop the test stream immediately
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
      console.log("[Permissions] Mic permission granted");
      return true;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[Permissions] Mic request failed:", err.name, err.message);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setMicPermission("denied");
        setMicError(
          "Microphone permission denied. Click the lock icon in your browser's address bar, allow microphone access for this site, then reload the page."
        );
        return false;
      }
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        // Permission granted at browser level but macOS is blocking — need to enable in System Settings
        setMicPermission("granted");
        setMicError(
          "No microphone detected. This is usually a macOS privacy issue. Go to System Settings → Privacy & Security → Microphone, and enable your browser. Then reload this page."
        );
        return false;
      }
      setMicPermission("unknown");
      setMicError(err.message || "Failed to access microphone.");
      return false;
    }
  }, []);

  // Pre-flight check: verify all required permissions before starting agents
  const checkPermissionsPreFlight = useCallback(async (): Promise<{ mic: boolean; screen: boolean }> => {
    console.log("[PreFlight] Checking permissions...");
    const micStatus = await checkMicPermission();
    let micOk = micStatus === "granted";
    
    // If mic is prompt/unknown, request it now
    if (!micOk && micStatus !== "denied") {
      micOk = await requestMicPermission();
    }
    
    // Screen capture permission can only be checked by attempting capture
    // We'll mark it as "unknown" until user starts capture
    const screenOk = screenPermission === "granted" || capturing;
    
    console.log("[PreFlight] Results — mic:", micOk ? "OK" : "FAILED", "| screen:", screenOk ? "OK" : "needs capture");
    return { mic: micOk, screen: screenOk };
  }, [checkMicPermission, requestMicPermission, screenPermission, capturing]);

  // Load tasks from backend on mount + check permissions
  useEffect(() => {
    fetch(`${API_URL}/api/tasks`)
      .then((res) => res.json())
      .then(setTasks)
      .catch(console.error);
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Check mic permission on mount (non-blocking)
    checkMicPermission();
  }, [checkMicPermission]);

  // Trigger interjection - grabs user attention; strikeCount capped at 3
  const triggerInterjection = useCallback(async (
    message: string, 
    strikeCount: number = 1, 
    mood: "cool" | "sad" | "angry" | "happy" = "cool",
    penalty?: { amount: number; balanceBefore: number; balanceAfter: number }
  ) => {
    // Prevent overlapping interjections
    if (interjectionActiveRef.current) {
      console.log("[Interjection] Skipped - another interjection is already active");
      return;
    }
    interjectionActiveRef.current = true;
    
    const cappedStrike = Math.min(3, Math.max(1, strikeCount));
    setInterjection(message);
    setInterjectionStrikeCount(cappedStrike);
    setManagerMood(mood);
    
    // Set penalty info for display
    if (penalty) {
      setPenaltyAmount(penalty.amount);
      setBalanceBefore(penalty.balanceBefore);
      setBalanceAfter(penalty.balanceAfter);
      setShowPenaltyAnimation(true);
      // Reset animation after 3 seconds
      setTimeout(() => setShowPenaltyAnimation(false), 3000);
    } else {
      setPenaltyAmount(null);
      setBalanceBefore(null);
      setBalanceAfter(null);
    }
    
    interjectionTtsPlayedRef.current = false;
    nonComplianceTtsPlayedRef.current = false;
    setNonComplianceCount(0);
    setInterjectionPhase("alert"); // Always start with TTS
    
    // At strike 3+: force redirect mode - TTS plays but no voice input
    if (cappedStrike >= 3) {
      setIsForceRedirectMode(true);
      console.log("[Interjection] Strike 3 - Force redirect mode: TTS will play, then auto-redirect (no voice input)");
    } else {
      setIsForceRedirectMode(false);
    }

    // 1. Play alert sound (beep)
    try {
      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.value = 800;
      oscillator.type = "sine";
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.log("Audio not available");
    }

    // 2. Desktop notification
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("🚨 Focus Check!", {
        body: cappedStrike >= 3 ? "Get back to work NOW!" : message,
        icon: "/favicon.ico",
        requireInteraction: true,
      });
    }

    // 3. Flash the tab title
    let flash = true;
    if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
    titleIntervalRef.current = setInterval(() => {
      document.title = flash ? "🚨 FOCUS! 🚨" : originalTitle.current;
      flash = !flash;
    }, 500);

    // 4. Try to focus our window/tab
    window.focus();

    // 5. LOCAL MODE: Use backend to switch to browser window (macOS)
    if (localModeRef.current) {
      try {
        await fetch(`${API_URL}/api/focus-browser`, { method: "POST" });
        console.log("Local mode: Focused browser window");
      } catch (e) {
        console.log("Local mode: Could not focus browser");
      }
    }
  }, []);

  // Strike level labels for logging/UI
  const strikeLabel = (n: number) => {
    if (n <= 1) return "gentle";
    if (n === 2) return "firm";
    if (n === 3) return "strict";
    return "maximum enforcement";
  };

  // When interjection modal is in "alert" phase, play TTS once
  // Strike 1-2: transition to "listening" for voice input
  // Strike 3+: transition to "ready" (no voice input, just force redirect)
  useEffect(() => {
    if (!interjection || interjectionPhase !== "alert" || interjectionTtsPlayedRef.current) return;
    interjectionTtsPlayedRef.current = true;
    const playbackId = ++ttsPlaybackIdRef.current; // so only this playback's onended updates phase
    const strike = Math.max(1, Math.min(3, interjectionStrikeCount));
    const forceRedirect = strike >= 3;
    console.log(`[Interjection TTS] Strike ${strike}/3 (${strikeLabel(strike)}) — playing message${forceRedirect ? " (force redirect after)" : ""}`);
    
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/interjection-speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: interjection,
            strike_count: interjectionStrikeCount,
            penalty_amount: penaltyAmount,
            balance_after: balanceAfter,
          }),
        });
        if (!res.ok) throw new Error("TTS failed");
        const blob = await res.blob();
        if (playbackId !== ttsPlaybackIdRef.current) return; // superseded by newer interjection
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (playbackId !== ttsPlaybackIdRef.current) return; // stale callback, ignore
          setMicError(null);
          if (forceRedirect) {
            // Strike 3+: skip voice input, go straight to ready
            console.log("[Interjection TTS] Strike 3+ — skipping voice input, forcing redirect");
            setInterjectionPhase("ready");
          } else {
            // Strike 1-2: allow voice input
            setInterjectionPhase("listening");
          }
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (playbackId !== ttsPlaybackIdRef.current) return;
          setMicError(null);
          setInterjectionPhase(forceRedirect ? "ready" : "listening");
        };
        await audio.play();
      } catch (e) {
        console.error("TTS error:", e);
        if (playbackId !== ttsPlaybackIdRef.current) return;
        setMicError(null);
        setInterjectionPhase(forceRedirect ? "ready" : "listening");
      }
    })();
  }, [interjection, interjectionPhase, interjectionStrikeCount, penaltyAmount, balanceAfter]);

  // When in "non-compliance" phase, play escalating TTS then force redirect
  useEffect(() => {
    if (!interjection || interjectionPhase !== "non-compliance" || nonComplianceTtsPlayedRef.current) return;
    nonComplianceTtsPlayedRef.current = true;
    const playbackId = ++ttsPlaybackIdRef.current;
    const pendingTasks = tasks.filter((t) => !t.done).length;
    
    console.log(`[Non-compliance TTS] Strike ${interjectionStrikeCount}, non-compliance #${nonComplianceCount}`);
    
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/non-compliance-speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strike_count: interjectionStrikeCount + nonComplianceCount,
            tasks_remaining: pendingTasks,
          }),
        });
        if (!res.ok) throw new Error("Non-compliance TTS failed");
        const blob = await res.blob();
        if (playbackId !== ttsPlaybackIdRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = async () => {
          URL.revokeObjectURL(url);
          if (playbackId !== ttsPlaybackIdRef.current) return;
          
          // Force redirect to productivity app
          if (localModeRef.current) {
            try {
              await fetch(`${API_URL}/api/focus-productive-app`, { method: "POST" });
              console.log("[Non-compliance] Force switched to productive app");
            } catch {
              console.log("[Non-compliance] Could not force switch");
            }
          }
          
          // If strikes >= 3 or many non-compliance events, keep them locked
          if (interjectionStrikeCount >= 3 || nonComplianceCount >= 2) {
            setIsForceRedirectMode(true);
            // Loop back to listening for another chance
            setInterjectionPhase("listening");
            setMicError("You must report progress or commit to working. Try again.");
          } else {
            // Give them a chance to acknowledge
            setInterjectionPhase("ready");
          }
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (playbackId !== ttsPlaybackIdRef.current) return;
          setInterjectionPhase("ready");
        };
        await audio.play();
      } catch (e) {
        console.error("Non-compliance TTS error:", e);
        if (playbackId !== ttsPlaybackIdRef.current) return;
        setInterjectionPhase("ready");
      }
    })();
  }, [interjection, interjectionPhase, interjectionStrikeCount, nonComplianceCount, tasks]);

  // Dark mode
  useEffect(() => {
    const saved = localStorage.getItem("darkMode");
    if (saved === "true") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Connect streams
  useEffect(() => {
    if (capturing && screenVideoRef.current && screenStreamRef.current) {
      screenVideoRef.current.srcObject = screenStreamRef.current;
    }
  }, [capturing]);

  useEffect(() => {
    if (cameraOn && cameraVideoRef.current && cameraStreamRef.current) {
      cameraVideoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraOn]);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", String(newMode));
    document.documentElement.classList.toggle("dark", newMode);
  };

  const toggleLocalMode = () => {
    const newMode = !localMode;
    setLocalMode(newMode);
    localModeRef.current = newMode;
  };

  // Task management
  const addTask = async () => {
    if (!newTask.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newTask }),
      });
      const task = await res.json();
      setTasks([...tasks, task]);
      setNewTask("");
    } catch (e) {
      console.error("Failed to add task:", e);
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      await fetch(`${API_URL}/api/tasks/${task.id}?done=${!task.done}`, { method: "PATCH" });
      setTasks(tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    } catch (e) {
      console.error("Failed to toggle task:", e);
    }
  };

  const extractTasks = async () => {
    if (!dailyInput.trim()) return;
    setExtracting(true);
    try {
      const res = await fetch(`${API_URL}/api/analyze-braindump`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: dailyInput }),
      });
      const data = await res.json();
      if (data.tasks) {
        for (const text of data.tasks) {
          const taskRes = await fetch(`${API_URL}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const task = await taskRes.json();
          setTasks((prev) => [...prev, task]);
        }
      }
    } catch (e) {
      console.error("Extract failed:", e);
    } finally {
      setExtracting(false);
    }
  };

  // Screen capture
  const startScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setCapturing(true);
      setScreenPermission("granted");
      stream.getVideoTracks()[0].onended = () => {
        setCapturing(false);
        screenStreamRef.current = null;
        stopAutoMode();
      };
    } catch (e) {
      console.error("Screen capture failed:", e);
      // User cancelled or denied screen sharing
      setScreenPermission("prompt");
    }
  };

  const stopScreenCapture = () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setCapturing(false);
    stopAutoMode();
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      setCameraOn(true);
    } catch (e) {
      console.error("Camera failed:", e);
    }
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraOn(false);
  };

  const captureFrame = (): string | null => {
    const video = screenVideoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
  };

  // Observer Agent (30s)
  const runObserver = useCallback(async () => {
    if (!capturing) return;
    const frame = captureFrame();
    if (!frame) return;

    setObserverStatus("Observing...");
    try {
      const res = await fetch(`${API_URL}/api/observe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: frame }),
      });
      const data = await res.json();
      setLastObservation(`${data.app_name}: ${data.description.slice(0, 100)}...`);
      setObserverStatus(`Last: ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setObserverStatus("Error");
    }
  }, [capturing]);

  // Manager Agent (~2 min interval)
  const runManager = useCallback(async () => {
    // Skip if an interjection is already active (prevent overlap)
    if (interjectionActiveRef.current) {
      console.log("[Manager] Skipped - interjection already active");
      // Still schedule next check
      if (autoModeRef.current) {
        const intervalRes = await fetch(`${API_URL}/api/next-manager-interval`);
        const { interval_seconds } = await intervalRes.json();
        console.log(`Manager: scheduling next check in ${interval_seconds}s (skipped current)`);
        managerRef.current = setTimeout(runManager, interval_seconds * 1000);
      }
      return;
    }
    
    setManagerStatus("Checking...");
    try {
      const res = await fetch(`${API_URL}/api/manager`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setIsProductive(data.is_productive);
      setManagerStatus(data.is_productive ? "✓ Productive" : "⚠ Distracted");

      // Show interjection popup directly if Manager says so (pass strike_count, mood, and penalty for character)
      if (data.interjection && data.interjection_message) {
        const penalty = data.penalty_amount ? {
          amount: data.penalty_amount,
          balanceBefore: data.balance_before,
          balanceAfter: data.balance_after
        } : undefined;
        triggerInterjection(data.interjection_message, data.strike_count ?? 1, data.mood ?? "cool", penalty);
      }

      // Refresh tasks if any were updated
      if (data.tasks_updated?.length) {
        const tasksRes = await fetch(`${API_URL}/api/tasks`);
        setTasks(await tasksRes.json());
      }

      // Schedule next manager check with random interval (use ref to avoid stale closure)
      if (autoModeRef.current) {
        const intervalRes = await fetch(`${API_URL}/api/next-manager-interval`);
        const { interval_seconds } = await intervalRes.json();
        console.log(`Manager: scheduling next check in ${interval_seconds}s`);
        managerRef.current = setTimeout(runManager, interval_seconds * 1000);
      }
    } catch (e) {
      setManagerStatus("Error");
    }
  }, [triggerInterjection]);

  const startVoiceResponse = async () => {
    setMicError(null);

    // Step 0: Clean up any stale recording from previous session
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore cleanup errors
      }
      mediaRecorderRef.current = null;
    }
    recordedChunksRef.current = [];

    // Small delay to ensure previous stream is fully released
    await new Promise((r) => setTimeout(r, 100));

    // Step 1: Check current permission status and enumerate devices for diagnostics
    const currentPermission = await checkMicPermission();
    console.log("[Mic] Permission status:", currentPermission);

    // Diagnostic: enumerate all devices at start
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioIn = allDevices.filter((d) => d.kind === "audioinput");
      const audioOut = allDevices.filter((d) => d.kind === "audiooutput");
      const videoIn = allDevices.filter((d) => d.kind === "videoinput");
      console.log(`[Mic] Devices at start: ${audioIn.length} audio inputs, ${audioOut.length} audio outputs, ${videoIn.length} video inputs`);
      if (audioIn.length > 0) {
        console.log("[Mic] Audio inputs:", audioIn.map((d) => d.label || `(unlabeled: ${d.deviceId.slice(0, 8)})`));
      }
    } catch (enumErr) {
      console.warn("[Mic] Initial enumeration failed:", enumErr);
    }

    // Step 2: If denied, show clear instructions to enable in browser
    if (currentPermission === "denied") {
      setMicError(
        "Microphone permission denied. Click the lock/site settings icon in your browser's address bar, allow microphone access for this site, then reload the page. You can Skip speaking to continue."
      );
      return;
    }

    // Step 3: If prompt/unknown, try to request permission first
    if (currentPermission === "prompt" || currentPermission === "unknown") {
      console.log("[Mic] Requesting permission...");
      const granted = await requestMicPermission();
      if (!granted) {
        // requestMicPermission already set the appropriate error
        return;
      }
    }

    // Step 4: Permission granted — now try to get an audio stream with retry logic
    let stream: MediaStream | null = null;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 500;

    try {
      for (let attempt = 1; attempt <= MAX_RETRIES && !stream; attempt++) {
        try {
          console.log(`[Mic] Attempt ${attempt}/${MAX_RETRIES} — requesting audio stream...`);
          
          // Try with different constraints on retries
          const constraints = attempt === 1 
            ? { audio: true }
            : attempt === 2
              ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
              : { audio: { sampleRate: 44100 } };
          
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log("[Mic] Got stream from device");
          break;
        } catch (e) {
          const err = e instanceof DOMException ? e : new DOMException(String(e), "UnknownError");
          console.warn(`[Mic] Attempt ${attempt} failed:`, err.name, err.message);

          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setMicPermission("denied");
            throw e;
          }

          if (attempt < MAX_RETRIES) {
            // Log device enumeration for debugging
            try {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const audioInputs = devices.filter((d) => d.kind === "audioinput");
              console.log(`[Mic] Device enumeration: ${audioInputs.length} input(s)`, 
                audioInputs.map((d) => ({ id: d.deviceId.slice(0, 8), label: d.label || "(no label)" }))
              );
            } catch (enumErr) {
              console.warn("[Mic] Device enumeration failed:", enumErr);
            }
            
            console.log(`[Mic] Waiting ${RETRY_DELAY_MS}ms before retry...`);
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          } else {
            // Final attempt failed — check if it's a device issue
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
            
            if (audioInputs.length === 0) {
              throw new DOMException("NO_AUDIO_INPUTS", "NotFoundError");
            } else {
              // Devices exist but none work — try each one explicitly
              console.log("[Mic] Trying each device explicitly...");
              for (const input of audioInputs) {
                try {
                  stream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: { exact: input.deviceId } },
                  });
                  console.log("[Mic] Success with device:", input.label || input.deviceId.slice(0, 12));
                  break;
                } catch {
                  console.warn("[Mic] Device failed:", input.label || input.deviceId.slice(0, 8));
                }
              }
              if (!stream) {
                throw new DOMException("NO_WORKING_DEVICE", "NotFoundError");
              }
            }
          }
        }
      }

      if (!stream) {
        setMicError(
          "Could not access microphone after multiple attempts. Try reloading the page or check that no other app is using the mic. You can Skip speaking to continue."
        );
        return;
      }

      // Step 5: Start recording
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setMicError(null);
      console.log("[Mic] Recording started successfully");
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[Mic] Final error:", err.name, err.message);

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setMicPermission("denied");
        setMicError(
          "Microphone permission denied. Click the lock/site settings icon in your browser's address bar, allow microphone access, then reload. You can Skip speaking to continue."
        );
      } else if (err.message === "NO_AUDIO_INPUTS") {
        setMicError(
          "No microphone detected. This is usually a macOS privacy issue. Go to System Settings → Privacy & Security → Microphone, and make sure your browser is enabled. Then reload this page. You can Skip speaking to continue."
        );
      } else if (err.message === "NO_WORKING_DEVICE") {
        setMicError(
          "Microphone found but not responding. Try: (1) Check if another app is using the mic, (2) Unplug and replug your mic, (3) Select a different input in System Settings → Sound → Input. You can Skip speaking to continue."
        );
      } else {
        setMicError(
          `Microphone error: ${err.message || "Unknown error"}. You can Skip speaking to continue.`
        );
      }
    }
  };

  const stopVoiceResponseAndAssess = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setIsTranscribing(true);
    setMicError(null); // Clear previous errors
    try {
      await new Promise((r) => setTimeout(r, 300));
      const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      recordedChunksRef.current = [];
      
      if (blob.size === 0) {
        throw new Error("No audio recorded. Please try speaking again.");
      }

      const formData = new FormData();
      formData.append("file", blob, "response.webm");
      const transRes = await fetch(`${API_URL}/api/transcribe`, {
        method: "POST",
        body: formData,
      });
      if (!transRes.ok) {
        const errorText = await transRes.text().catch(() => "");
        throw new Error(`Transcription failed: ${transRes.status}${errorText ? ` - ${errorText}` : ""}`);
      }
      const { text } = await transRes.json();
      
      if (!text?.trim()) {
        // No response - treat as non-compliant
        setNonComplianceCount((c) => c + 1);
        setManagerMood(interjectionStrikeCount >= 2 ? "angry" : "sad"); // Escalate mood
        nonComplianceTtsPlayedRef.current = false;
        setInterjectionPhase("non-compliance");
        setIsTranscribing(false);
        return;
      }
      
      if (tasks.length > 0) {
        const assessRes = await fetch(`${API_URL}/api/assess-task-completion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, task_list: tasks }),
        });
        
        if (assessRes.ok) {
          const { tasks_to_complete, is_compliant, compliance_message } = await assessRes.json();
          
          if (tasks_to_complete?.length > 0) {
            // Success - refresh task list
            const tasksRes = await fetch(`${API_URL}/api/tasks`);
            setTasks(await tasksRes.json());
            console.log("[Voice] Marked tasks complete:", tasks_to_complete);
            setNonComplianceCount(0); // Reset on success
            setManagerMood("happy"); // Manager is pleased!
            setInterjectionPhase("ready");
          } else if (!is_compliant) {
            // Non-compliant response - escalate
            console.log("[Voice] Non-compliant:", compliance_message);
            setNonComplianceCount((c) => c + 1);
            setManagerMood(interjectionStrikeCount >= 2 ? "angry" : "sad"); // Escalate mood
            nonComplianceTtsPlayedRef.current = false;
            setInterjectionPhase("non-compliance");
          } else {
            // Compliant but no tasks completed (e.g., "I'll get back to work")
            setMicError(compliance_message || "No tasks completed, but acknowledged.");
            setNonComplianceCount(0);
            setInterjectionPhase("ready");
          }
        } else {
          setMicError("Could not assess your progress. Your tasks were not updated.");
          setInterjectionPhase("ready");
        }
      } else {
        setInterjectionPhase("ready");
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("Transcribe/assess error:", err);
      setMicError(err.message || "Failed to process your voice response. Please try again or skip.");
      setInterjectionPhase("ready");
    } finally {
      setIsTranscribing(false);
    }
  };

  const acknowledgeInterjection = async () => {
    // Reset local state
    setInterjection(null);
    setInterjectionPhase("alert");
    setManagerMood("cool"); // Reset mood
    setMicError(null);
    setNonComplianceCount(0);
    setIsForceRedirectMode(false);
    nonComplianceTtsPlayedRef.current = false;
    interjectionActiveRef.current = false; // Allow new interjections
    
    // Reset penalty display
    setPenaltyAmount(null);
    setBalanceBefore(null);
    setBalanceAfter(null);
    setShowPenaltyAnimation(false);
    
    // Stop title flashing
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current);
      titleIntervalRef.current = null;
    }
    document.title = originalTitle.current;

    // Acknowledge on backend (note: strikes are NOT reset - only compaction resets them)
    try {
      const res = await fetch(`${API_URL}/api/interjection/acknowledge`, { method: "POST" });
      const data = await res.json();
      console.log(`[Acknowledge] Strike count remains: ${data.strike_count}`);
      // Update local strike count
      setInterjectionStrikeCount(data.strike_count || 0);
    } catch (e) {
      console.log("Acknowledge failed:", e);
    }

    // LOCAL MODE: Switch to productive app (Cursor, VS Code, etc.)
    if (localModeRef.current) {
      try {
        const res = await fetch(`${API_URL}/api/focus-productive-app`, { method: "POST" });
        const data = await res.json();
        if (data.app) {
          console.log(`Local mode: Switched to ${data.app}`);
        }
      } catch (e) {
        console.log("Local mode: Could not switch to productive app");
      }
    }
  };

  // Auto mode control
  const startAutoMode = async () => {
    if (!capturing) return;

    // Pre-flight: check and request mic permission (non-blocking, but log status)
    console.log("[AutoMode] Running pre-flight permission checks...");
    const { mic } = await checkPermissionsPreFlight();
    if (!mic) {
      console.warn("[AutoMode] Microphone not available — voice response will be unavailable during interjections");
    }

    setAutoMode(true);
    autoModeRef.current = true; // Update ref for callbacks

    // Start Observer (every 30s)
    runObserver();
    observerRef.current = setInterval(runObserver, 30000);

    // Start Manager (random 45-60s)
    runManager();

    // Start Compaction (every 30min)
    compactionRef.current = setInterval(async () => {
      try {
        await fetch(`${API_URL}/api/compact`, { method: "POST" });
      } catch (e) {
        console.error("Compaction failed:", e);
      }
    }, 1800000);
  };

  const stopAutoMode = () => {
    setAutoMode(false);
    autoModeRef.current = false; // Update ref for callbacks
    if (observerRef.current) clearInterval(observerRef.current);
    if (managerRef.current) clearTimeout(managerRef.current);
    if (compactionRef.current) clearInterval(compactionRef.current);
    observerRef.current = null;
    managerRef.current = null;
    compactionRef.current = null;
    setObserverStatus("Idle");
    setManagerStatus("Idle");
  };

  // Settings functions
  const fetchSettingsData = async () => {
    try {
      // Fetch SBI balance
      const sbiRes = await fetch(`${API_URL}/api/sbi/account`);
      if (sbiRes.ok) {
        const sbiData = await sbiRes.json();
        setSbiBalance(sbiData.balance);
      }
      
      // Fetch Blinkit order count
      const blinkitRes = await fetch(`${API_URL}/api/blinkit/orders?limit=100`);
      if (blinkitRes.ok) {
        const orders = await blinkitRes.json();
        setBlinkitOrderCount(orders.length);
      }
    } catch (e) {
      console.error("Failed to fetch settings data:", e);
    }
  };

  const handleResetAll = async () => {
    if (!confirm("⚠️ This will delete ALL data including tasks, observations, bank transactions, and orders. Are you sure?")) {
      return;
    }
    
    setIsResetting(true);
    try {
      // Stop agents first
      stopAutoMode();
      
      const res = await fetch(`${API_URL}/api/reset-all`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        // Refresh local state
        setTasks([]);
        setSbiBalance(data.sbi_balance);
        setBlinkitOrderCount(0);
        setObserverStatus("Idle");
        setManagerStatus("Idle");
        setLastObservation("");
        setIsProductive(true);
        alert("✅ All data has been reset!");
      } else {
        alert("❌ Failed to reset data");
      }
    } catch (e) {
      console.error("Reset failed:", e);
      alert("❌ Reset failed: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setIsResetting(false);
    }
  };

  const handleResetSBI = async () => {
    if (!confirm("Reset SBI Bank to ₹10,000?")) return;
    try {
      const res = await fetch(`${API_URL}/api/sbi/reset`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSbiBalance(data.balance);
      }
    } catch (e) {
      console.error("SBI reset failed:", e);
    }
  };

  const handleResetBlinkit = async () => {
    if (!confirm("Clear all Blinkit orders?")) return;
    try {
      await fetch(`${API_URL}/api/blinkit/reset`, { method: "POST" });
      setBlinkitOrderCount(0);
    } catch (e) {
      console.error("Blinkit reset failed:", e);
    }
  };

  // Fetch settings data when modal opens
  useEffect(() => {
    if (showSettings) {
      fetchSettingsData();
    }
  }, [showSettings]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopAutoMode();
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 transition-colors">
      {/* Interjection Popup: TTS → voice response → acknowledge */}
      {interjection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            {/* Manager Character */}
            <div className="mb-4 flex justify-center">
              <div className={`relative rounded-full p-2 ${
                managerMood === "angry" ? "bg-red-100 dark:bg-red-900/30" :
                managerMood === "sad" ? "bg-amber-100 dark:bg-amber-900/30" :
                managerMood === "happy" ? "bg-green-100 dark:bg-green-900/30" :
                "bg-blue-100 dark:bg-blue-900/30"
              }`}>
                <Image 
                  src={`/assets/${managerMood}.png`} 
                  alt={`Manager is ${managerMood}`}
                  width={96}
                  height={96}
                  className={`object-contain ${
                    interjectionPhase === "alert" ? "animate-bounce" :
                    interjectionPhase === "non-compliance" ? "animate-pulse" : ""
                  }`}
                  priority
                />
              </div>
            </div>
            
            {/* 💸 SBI BANK PENALTY DISPLAY */}
            {penaltyAmount && (
              <div className={`mb-4 rounded-lg border-2 overflow-hidden ${
                showPenaltyAnimation ? "border-red-500 animate-pulse" : "border-blue-600"
              }`}>
                {/* SBI Bank Header */}
                <div className="bg-blue-600 px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-bold text-xs">SBI</span>
                    </div>
                    <div>
                      <p className="text-white text-xs font-semibold">State Bank of India</p>
                      <p className="text-blue-200 text-[10px]">DEMO - Virtual Account</p>
                    </div>
                  </div>
                  <span className="text-red-300 text-xs font-medium">PENALTY</span>
                </div>
                
                {/* Balance Display */}
                <div className="bg-gradient-to-b from-blue-50 to-white dark:from-blue-950 dark:to-zinc-900 p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-zinc-500">Previous Balance</span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">₹{balanceBefore?.toLocaleString()}</span>
                  </div>
                  
                  <div className={`flex justify-between items-center mb-2 py-1 px-2 rounded ${
                    showPenaltyAnimation ? "bg-red-100 dark:bg-red-900/30" : "bg-red-50 dark:bg-red-900/20"
                  }`}>
                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">Penalty Deducted</span>
                    <span className={`text-lg font-bold text-red-600 dark:text-red-400 ${
                      showPenaltyAnimation ? "animate-bounce" : ""
                    }`}>
                      -₹{penaltyAmount?.toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">New Balance</span>
                    <span className={`text-xl font-bold ${
                      (balanceAfter ?? 0) < 1000 ? "text-red-600" : "text-blue-600"
                    }`}>
                      ₹{balanceAfter?.toLocaleString()}
                    </span>
                  </div>
                  
                  {(balanceAfter ?? 0) < 1000 && (
                    <p className="text-[10px] text-red-500 mt-1 text-center">⚠️ Low balance warning!</p>
                  )}
                </div>
              </div>
            )}
            
            <div className="mb-4 flex items-center justify-between gap-3 text-orange-500">
              <div className="flex items-center gap-3">
                <AlertTriangle className={`h-6 w-6 ${isForceRedirectMode || interjectionPhase === "non-compliance" ? "text-red-500" : ""}`} />
                <h2 className="text-xl font-bold">
                  {interjectionPhase === "alert" && "Hey, focus!"}
                  {interjectionPhase === "listening" && "Your turn"}
                  {interjectionPhase === "non-compliance" && "Not acceptable"}
                  {interjectionPhase === "ready" && (isForceRedirectMode ? "STOP NOW" : "Back to work")}
                </h2>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  interjectionStrikeCount >= 3 
                    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" 
                    : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                }`} title={`TTS strictness: ${strikeLabel(interjectionStrikeCount)}`}>
                  Strike {interjectionStrikeCount} {interjectionStrikeCount >= 3 && "⚠️"}
                </span>
                {isForceRedirectMode && (
                  <span className="text-xs text-red-500">Force redirect active</span>
                )}
              </div>
            </div>
            <p className="mb-4 text-zinc-700 dark:text-zinc-300">{interjection}</p>

            {interjectionPhase === "alert" && (
              <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Volume2 className="h-4 w-4" />
                Playing message…
              </p>
            )}

            {interjectionPhase === "listening" && (
              <div className="mb-4 space-y-3">
                {micError && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                    {micError}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  How much of the work have you completed? Tell me which tasks you&apos;ve finished.
                </p>
                {isTranscribing ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Assessing your progress…
                  </p>
                ) : isRecording ? (
                  <Button
                    variant="destructive"
                    onClick={stopVoiceResponseAndAssess}
                    className="w-full"
                  >
                    <MicOff className="mr-2 h-4 w-4" />
                    Done speaking
                  </Button>
                ) : micPermission === "denied" ? (
                  <div className="space-y-2">
                    <p className="text-sm text-destructive">
                      Microphone access is blocked. To enable it:
                    </p>
                    <ol className="ml-4 list-decimal text-xs text-muted-foreground">
                      <li>Click the lock/site settings icon in your address bar</li>
                      <li>Find &quot;Microphone&quot; and set it to &quot;Allow&quot;</li>
                      <li>Reload this page</li>
                    </ol>
                    <Button
                      variant="outline"
                      onClick={() => window.location.reload()}
                      className="w-full"
                    >
                      Reload page
                    </Button>
                  </div>
                ) : micError?.includes("macOS") ? (
                  <div className="space-y-2">
                    <p className="text-sm text-destructive">
                      macOS is blocking microphone access. To fix:
                    </p>
                    <ol className="ml-4 list-decimal text-xs text-muted-foreground">
                      <li>Open <strong>System Settings</strong> → <strong>Privacy &amp; Security</strong></li>
                      <li>Click <strong>Microphone</strong> in the left sidebar</li>
                      <li>Enable your browser (Chrome, Arc, Safari, etc.)</li>
                      <li>Reload this page</li>
                    </ol>
                    <Button
                      variant="outline"
                      onClick={() => window.location.reload()}
                      className="w-full"
                    >
                      Reload page after enabling
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={startVoiceResponse}
                    className="w-full"
                  >
                    <Mic className="mr-2 h-4 w-4" />
                    {micPermission === "prompt" || micPermission === "unknown" ? "Grant mic access & speak" : "Start speaking"}
                  </Button>
                )}
                {!isForceRedirectMode && (
                  <Button variant="ghost" size="sm" onClick={() => setInterjectionPhase("ready")} className="w-full text-muted-foreground">
                    Skip speaking →
                  </Button>
                )}
              </div>
            )}

            {interjectionPhase === "non-compliance" && (
              <div className="mb-4 space-y-3">
                <div className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200" role="alert">
                  <p className="font-medium">You haven&apos;t made progress on your tasks.</p>
                  <p className="mt-1 text-xs">Listening to your explanation...</p>
                </div>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Volume2 className="h-4 w-4 animate-pulse" />
                  Playing message...
                </p>
              </div>
            )}

            {interjectionPhase === "ready" && (
              <div className="space-y-3">
                {isForceRedirectMode ? (
                  <div className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200" role="alert">
                    <p className="font-semibold">Strike 3 - Maximum Enforcement</p>
                    <p className="mt-1">You&apos;ve been distracted too many times. No more chances. Get back to work immediately.</p>
                  </div>
                ) : micError ? (
                  <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" role="alert">
                    {micError}
                  </p>
                ) : null}
                <Button onClick={acknowledgeInterjection} className="w-full">
                  {isForceRedirectMode ? "Go to work NOW" : "Got it, back to work!"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Settings
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)} className="h-8 w-8 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* SBI Bank Status */}
            <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <Banknote className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">SBI Bank (Demo)</p>
                    <p className="text-xs text-muted-foreground">Virtual penalty account</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-blue-600">
                  ₹{sbiBalance?.toLocaleString() ?? "..."}
                </span>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleResetSBI}
                className="w-full text-xs"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Reset to ₹10,000
              </Button>
            </div>
            
            {/* Blinkit Status */}
            <div className="mb-4 rounded-lg border border-green-200 dark:border-green-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                    <ShoppingBag className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Blinkit Rewards (Demo)</p>
                    <p className="text-xs text-muted-foreground">Virtual reward orders</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-green-600">
                  {blinkitOrderCount} orders
                </span>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleResetBlinkit}
                className="w-full text-xs"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear Order History
              </Button>
            </div>
            
            {/* Task Stats */}
            <div className="mb-6 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                    <Target className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Tasks</p>
                    <p className="text-xs text-muted-foreground">Current objectives</p>
                  </div>
                </div>
                <span className="text-lg font-bold">
                  {tasks.filter(t => t.done).length}/{tasks.length}
                </span>
              </div>
            </div>
            
            {/* Danger Zone */}
            <div className="rounded-lg border-2 border-red-200 dark:border-red-800 p-4 bg-red-50 dark:bg-red-950/20">
              <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Danger Zone
              </h3>
              <p className="text-xs text-red-600/80 dark:text-red-400/80 mb-3">
                This will permanently delete all tasks, observations, bank transactions, and reward orders.
              </p>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleResetAll}
                disabled={isResetting}
                className="w-full"
              >
                {isResetting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Reset All Data & Start Fresh
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-3">
        {/* Header */}
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Multi-Agent Productivity</h1>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span>🔍 Observer: {observerStatus}</span>
                <span>👔 Manager: {managerStatus}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowSettings(true)} className="h-8 w-8 p-0" title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
            
            <Button size="sm" variant="ghost" onClick={toggleDarkMode} className="h-8 w-8 p-0">
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              size="sm"
              variant={localMode ? "default" : "outline"}
              onClick={toggleLocalMode}
              className={`h-8 ${localMode ? "bg-blue-600 hover:bg-blue-700" : ""}`}
              title="Local mode: Switch windows on interjection (macOS)"
            >
              <Laptop className="mr-1.5 h-3.5 w-3.5" />
              Local
            </Button>

            {capturing && (
              <Button
                size="sm"
                variant={autoMode ? "default" : "outline"}
                onClick={autoMode ? stopAutoMode : startAutoMode}
                className={`h-8 ${autoMode ? "bg-green-600 hover:bg-green-700" : ""}`}
              >
                {autoMode ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                {autoMode ? "Stop Agents" : "Start Agents"}
              </Button>
            )}

            <Button
              size="sm"
              variant={cameraOn ? "outline" : "ghost"}
              onClick={cameraOn ? stopCamera : startCamera}
              className="h-8"
            >
              {cameraOn ? <VideoOff className="mr-1.5 h-3.5 w-3.5" /> : <Video className="mr-1.5 h-3.5 w-3.5" />}
              Camera
            </Button>

            <Button
              size="sm"
              variant={capturing ? "destructive" : "default"}
              onClick={capturing ? stopScreenCapture : startScreenCapture}
              className="h-8"
            >
              {capturing ? <MonitorOff className="mr-1.5 h-3.5 w-3.5" /> : <Monitor className="mr-1.5 h-3.5 w-3.5" />}
              {capturing ? "Stop" : "Screen"}
            </Button>
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
          {/* Left - Brain Dump */}
          <Card className="flex flex-col border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-2 px-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                <Brain className="h-4 w-4 text-primary" />
                Brain Dump
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-0">
              <Textarea
                placeholder="Dump your thoughts, goals, plans..."
                className="min-h-[100px] resize-none text-sm"
                value={dailyInput}
                onChange={(e) => setDailyInput(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={extractTasks}
                disabled={extracting || !dailyInput.trim()}
                className="h-7 text-xs"
              >
                {extracting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                Extract Tasks
              </Button>
              
              {lastObservation && (
                <div className="mt-auto rounded bg-zinc-100 p-2 text-[10px] text-muted-foreground dark:bg-zinc-900">
                  <div className="font-medium mb-1">Last Observation:</div>
                  {lastObservation}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Center - Screen Preview */}
          <Card className="flex flex-col border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-2 px-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <span>Screen</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  isProductive 
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                }`}>
                  {isProductive ? "Productive" : "Distracted"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-0">
              <div className="relative flex-1 overflow-hidden rounded-lg bg-zinc-900">
                {capturing ? (
                  <video ref={screenVideoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-500">
                    <div className="text-center">
                      <Monitor className="mx-auto h-12 w-12 mb-2 opacity-50" />
                      <p className="text-sm">Click &quot;Screen&quot; to start</p>
                    </div>
                  </div>
                )}

                {capturing && autoMode && (
                  <div className="absolute top-2 left-2 flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-medium text-white">
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                      LIVE
                    </div>
                    <div className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
                      AGENTS ACTIVE
                    </div>
                  </div>
                )}

                {cameraOn && (
                  <div className="absolute bottom-2 right-2 h-20 w-28 overflow-hidden rounded-lg border-2 border-white shadow-lg">
                    <video ref={cameraVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right - Tasks */}
          <Card className="flex flex-col border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-2 px-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                <Target className="h-4 w-4 text-orange-500" />
                Daily Objectives
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-0">
              <div className="flex gap-1">
                <Input
                  placeholder="Add objective..."
                  className="h-7 text-xs"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                />
                <Button onClick={addTask} size="sm" className="h-7 w-7 p-0">+</Button>
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {tasks.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground/60">
                    Add your daily objectives
                  </p>
                ) : (
                  tasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => toggleTask(task)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-all ${
                        task.done
                          ? "bg-green-50 dark:bg-green-950/20"
                          : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {task.done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      )}
                      <span className={`text-xs ${task.done ? "text-muted-foreground line-through" : ""}`}>
                        {task.text}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {tasks.length > 0 && (
                <div className="border-t border-zinc-100 pt-2 text-center text-[10px] text-muted-foreground dark:border-zinc-800">
                  {tasks.filter((t) => t.done).length}/{tasks.length} completed
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
