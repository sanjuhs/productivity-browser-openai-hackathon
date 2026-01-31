"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  
  // Interjection popup
  const [interjection, setInterjection] = useState<string | null>(null);

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

  // Load tasks from backend on mount
  useEffect(() => {
    fetch(`${API_URL}/api/tasks`)
      .then((res) => res.json())
      .then(setTasks)
      .catch(console.error);
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Trigger interjection - grabs user attention
  const triggerInterjection = useCallback(async (message: string) => {
    setInterjection(message);

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
        body: message,
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
      stream.getVideoTracks()[0].onended = () => {
        setCapturing(false);
        screenStreamRef.current = null;
        stopAutoMode();
      };
    } catch (e) {
      console.error("Screen capture failed:", e);
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

  // Manager Agent (45-60s random)
  const runManager = useCallback(async () => {
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

      // Show interjection popup directly if Manager says so
      if (data.interjection && data.interjection_message) {
        triggerInterjection(data.interjection_message);
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

  const acknowledgeInterjection = async () => {
    setInterjection(null);
    // Stop title flashing
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current);
      titleIntervalRef.current = null;
    }
    document.title = originalTitle.current;

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
  const startAutoMode = () => {
    if (!capturing) return;
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

  // Cleanup on unmount
  useEffect(() => {
    return () => stopAutoMode();
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 transition-colors">
      {/* Interjection Popup */}
      {interjection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="mb-4 flex items-center gap-3 text-orange-500">
              <AlertTriangle className="h-8 w-8" />
              <h2 className="text-xl font-bold">Hey, focus!</h2>
            </div>
            <p className="mb-6 text-zinc-700 dark:text-zinc-300">{interjection}</p>
            <Button onClick={acknowledgeInterjection} className="w-full">
              Got it, back to work!
            </Button>
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
