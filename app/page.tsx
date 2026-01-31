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
  Eye,
  Play,
  Pause,
  Clock,
} from "lucide-react";

const API_URL = "http://localhost:8000";

interface Summary {
  timestamp: string;
  summary: string;
}

export default function Home() {
  const [darkMode, setDarkMode] = useState(false);
  const [dailyInput, setDailyInput] = useState("");
  const [focusTask, setFocusTask] = useState("");
  const [tasks, setTasks] = useState<{ text: string; done: boolean }[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [companionThought, setCompanionThought] = useState("Ready to help you focus!");
  const [isFocused, setIsFocused] = useState(true);
  const [lastAnalysis, setLastAnalysis] = useState("");
  const [analysisMethod, setAnalysisMethod] = useState<string | null>(null);
  const [lastAnalyzeTime, setLastAnalyzeTime] = useState<Date | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  
  // Config from backend
  const [analysisInterval, setAnalysisInterval] = useState(2000); // 2 seconds default
  const [summaryInterval, setSummaryInterval] = useState(180000); // 3 minutes default

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const autoAnalyzeRef = useRef<NodeJS.Timeout | null>(null);
  const summaryRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch config from backend on mount
  useEffect(() => {
    fetch(`${API_URL}/api/config`)
      .then((res) => res.json())
      .then((data) => {
        setAnalysisInterval(data.analysis_interval_seconds * 1000);
        setSummaryInterval(data.summary_interval_seconds * 1000);
      })
      .catch(console.error);
  }, []);

  // Dark mode
  useEffect(() => {
    const saved = localStorage.getItem("darkMode");
    if (saved === "true") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Connect streams to video elements
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
    if (newMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const addTask = () => {
    if (focusTask.trim()) {
      setTasks([...tasks, { text: focusTask, done: false }]);
      setFocusTask("");
    }
  };

  const toggleTask = (index: number) => {
    setTasks(tasks.map((t, i) => (i === index ? { ...t, done: !t.done } : t)));
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
        setTasks((prev) => [
          ...prev,
          ...data.tasks.map((t: string) => ({ text: t, done: false })),
        ]);
      }
      if (data.analysis) setLastAnalysis(data.analysis);
    } catch (e) {
      console.error("Extract failed:", e);
    } finally {
      setExtracting(false);
    }
  };

  const startScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = stream;
      setCapturing(true);
      stream.getVideoTracks()[0].onended = () => {
        setCapturing(false);
        screenStreamRef.current = null;
        setAutoAnalyze(false);
      };
    } catch (e) {
      console.error("Screen capture failed:", e);
    }
  };

  const stopScreenCapture = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setCapturing(false);
    setAutoAnalyze(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOn(true);
    } catch (e) {
      console.error("Camera failed:", e);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraOn(false);
  };

  const captureFrame = (video: HTMLVideoElement): string | null => {
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  const generateSummary = async () => {
    try {
      const res = await fetch(`${API_URL}/api/generate-summary`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSummaries((prev) => [
          { timestamp: data.timestamp, summary: data.summary },
          ...prev.slice(0, 9), // Keep last 10
        ]);
      }
    } catch (e) {
      console.error("Summary generation failed:", e);
    }
  };

  const analyzeScreen = useCallback(async () => {
    const hasScreen = capturing && screenVideoRef.current && screenStreamRef.current;
    const hasCamera = cameraOn && cameraVideoRef.current && cameraStreamRef.current;

    if (!hasScreen && !hasCamera) {
      setCompanionThought("Start screen capture or camera first!");
      return;
    }

    setAnalyzing(true);
    setCompanionThought("Analyzing...");

    try {
      let imageBase64: string | null = null;

      if (hasScreen && screenVideoRef.current) {
        imageBase64 = captureFrame(screenVideoRef.current);
      } else if (hasCamera && cameraVideoRef.current) {
        imageBase64 = captureFrame(cameraVideoRef.current);
      }

      if (!imageBase64) {
        throw new Error("Could not capture frame");
      }

      const currentTaskTexts = tasks.filter((t) => !t.done).map((t) => t.text);

      const res = await fetch(`${API_URL}/api/analyze-screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imageBase64,
          current_tasks: currentTaskTexts,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();

      if (data.analysis) setLastAnalysis(data.analysis);
      if (data.thought) setCompanionThought(data.thought);
      if (data.is_focused !== undefined) setIsFocused(data.is_focused);
      if (data.method) setAnalysisMethod(data.method);
      setLastAnalyzeTime(new Date());

      // Complete tasks that match (no new tasks created)
      if (data.tasks_to_complete?.length) {
        setTasks((prev) =>
          prev.map((task) => {
            const shouldComplete = data.tasks_to_complete.some(
              (completed: string) =>
                task.text.toLowerCase().includes(completed.toLowerCase()) ||
                completed.toLowerCase().includes(task.text.toLowerCase())
            );
            return shouldComplete ? { ...task, done: true } : task;
          })
        );
      }
    } catch (e) {
      console.error("Analysis failed:", e);
      setCompanionThought("Couldn't analyze. Try again?");
    } finally {
      setAnalyzing(false);
    }
  }, [capturing, cameraOn, tasks]);

  // Auto-analyze at configured interval
  useEffect(() => {
    if (autoAnalyze && (capturing || cameraOn)) {
      // Analysis interval
      autoAnalyzeRef.current = setInterval(() => {
        analyzeScreen();
      }, analysisInterval);

      // Summary interval
      summaryRef.current = setInterval(() => {
        generateSummary();
      }, summaryInterval);

      // Run analysis immediately on start
      analyzeScreen();
    }

    return () => {
      if (autoAnalyzeRef.current) {
        clearInterval(autoAnalyzeRef.current);
        autoAnalyzeRef.current = null;
      }
      if (summaryRef.current) {
        clearInterval(summaryRef.current);
        summaryRef.current = null;
      }
    };
  }, [autoAnalyze, capturing, cameraOn, analyzeScreen, analysisInterval, summaryInterval]);

  const toggleAutoAnalyze = () => {
    if (!capturing && !cameraOn) {
      setCompanionThought("Start capture first!");
      return;
    }
    setAutoAnalyze(!autoAnalyze);
  };

  const hasAnyCapture = capturing || cameraOn;

  return (
    <div className="h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 transition-colors">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-3">
        {/* Header */}
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <h1 className="text-base font-semibold">Productivity Assistant</h1>
            <span className="text-[10px] text-muted-foreground">
              ({analysisInterval / 1000}s interval)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={toggleDarkMode} className="h-8 w-8 p-0">
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {hasAnyCapture && (
              <Button
                size="sm"
                variant={autoAnalyze ? "default" : "outline"}
                onClick={toggleAutoAnalyze}
                className={`h-8 ${autoAnalyze ? "bg-green-600 hover:bg-green-700" : ""}`}
              >
                {autoAnalyze ? (
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                Auto
              </Button>
            )}

            {hasAnyCapture && (
              <Button
                size="sm"
                variant="default"
                onClick={analyzeScreen}
                disabled={analyzing}
                className="h-8 bg-blue-600 hover:bg-blue-700"
              >
                {analyzing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                )}
                Analyze
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
          {/* Left - Brain Dump + Summaries */}
          <Card className="flex flex-col border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-2 px-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                <Brain className="h-4 w-4 text-primary" />
                Brain Dump
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-0 overflow-hidden">
              <Textarea
                placeholder="Dump your thoughts..."
                className="min-h-[80px] resize-none text-sm"
                value={dailyInput}
                onChange={(e) => setDailyInput(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{dailyInput.length}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={extractTasks}
                  disabled={extracting || !dailyInput.trim()}
                  className="h-6 text-xs"
                >
                  {extracting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                  Extract Tasks
                </Button>
              </div>
              
              {/* Activity Summaries */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {lastAnalysis && (
                  <div className="rounded bg-blue-50 dark:bg-blue-950/30 p-2 text-xs text-blue-700 dark:text-blue-300">
                    <span className="font-medium">Current: </span>{lastAnalysis}
                  </div>
                )}
                {summaries.map((s, i) => (
                  <div key={i} className="rounded bg-zinc-100 dark:bg-zinc-900 p-2 text-xs text-muted-foreground">
                    <div className="text-[10px] text-muted-foreground/60 mb-1">
                      {new Date(s.timestamp).toLocaleTimeString()}
                    </div>
                    {s.summary}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Center - Companion & Preview */}
          <Card className="flex flex-col border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-2 px-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <span>Companion</span>
                {analysisMethod && (
                  <span className="text-[10px] font-normal text-muted-foreground">
                    via {analysisMethod.toUpperCase()}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-0">
              <div className="relative flex-1 overflow-hidden rounded-lg bg-zinc-900">
                {capturing && (
                  <video ref={screenVideoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
                )}

                {!capturing && (
                  <div className="flex h-full flex-col items-center justify-center bg-zinc-100 dark:bg-zinc-900">
                    <div className="relative">
                      <div
                        className={`flex h-16 w-16 items-center justify-center rounded-full transition-all ${
                          isFocused
                            ? "bg-gradient-to-br from-green-200 to-green-400 dark:from-green-800 dark:to-green-600"
                            : "bg-gradient-to-br from-orange-200 to-orange-400 dark:from-orange-800 dark:to-orange-600"
                        }`}
                      >
                        <span className="text-3xl">{isFocused ? "😊" : "🤔"}</span>
                      </div>
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white dark:border-zinc-900 ${
                          isFocused ? "bg-green-500" : "bg-orange-500"
                        }`}
                      />
                    </div>
                  </div>
                )}

                {capturing && (
                  <div className="absolute top-2 left-2 flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-medium text-white">
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                      LIVE
                    </div>
                    {autoAnalyze && (
                      <div className="flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
                        <Clock className="h-2.5 w-2.5" />
                        AUTO
                      </div>
                    )}
                  </div>
                )}

                {cameraOn && (
                  <div className="absolute bottom-2 right-2 h-20 w-28 overflow-hidden rounded-lg border-2 border-white shadow-lg dark:border-zinc-700">
                    <video ref={cameraVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                  </div>
                )}
              </div>

              <div
                className={`rounded-lg px-3 py-2 text-center text-xs transition-colors ${
                  isFocused
                    ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                    : "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                }`}
              >
                {analyzing ? (
                  <span className="flex items-center justify-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing...
                  </span>
                ) : (
                  companionThought
                )}
              </div>

              {lastAnalyzeTime && (
                <div className="text-center text-[10px] text-muted-foreground">
                  Last: {lastAnalyzeTime.toLocaleTimeString()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right - Focus Tasks */}
          <Card className="flex flex-col border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-2 px-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                <Target className="h-4 w-4 text-orange-500" />
                Focus Tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-0">
              <div className="flex gap-1">
                <Input
                  placeholder="Add task..."
                  className="h-7 text-xs"
                  value={focusTask}
                  onChange={(e) => setFocusTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                />
                <Button onClick={addTask} size="sm" className="h-7 w-7 p-0 text-sm">
                  +
                </Button>
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {tasks.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground/60">No tasks yet</p>
                ) : (
                  tasks.map((task, i) => (
                    <button
                      key={i}
                      onClick={() => toggleTask(i)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-all ${
                        task.done
                          ? "bg-green-50 dark:bg-green-950/20"
                          : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {task.done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      )}
                      <span className={`text-xs ${task.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                        {task.text}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {tasks.length > 0 && (
                <div className="flex items-center justify-between border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
                  <span className="text-[10px] text-muted-foreground">
                    {tasks.filter((t) => t.done).length}/{tasks.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => setTasks(tasks.filter((t) => !t.done))}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
