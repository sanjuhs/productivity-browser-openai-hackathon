"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, Target, Brain, CheckCircle2, Circle } from "lucide-react";

export default function Home() {
  const [dailyInput, setDailyInput] = useState("");
  const [focusTask, setFocusTask] = useState("");
  const [tasks, setTasks] = useState<{ text: string; done: boolean }[]>([]);

  const addTask = () => {
    if (focusTask.trim()) {
      setTasks([...tasks, { text: focusTask, done: false }]);
      setFocusTask("");
    }
  };

  const toggleTask = (index: number) => {
    setTasks(tasks.map((t, i) => (i === index ? { ...t, done: !t.done } : t)));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-zinc-100 dark:from-zinc-950 dark:via-black dark:to-zinc-900">
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <header className="mb-12 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/5 px-4 py-1.5 text-sm text-primary">
            <Sparkles className="h-4 w-4" />
            Productivity Browser Assistant
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Focus. Create. Achieve.
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your AI companion for deep work sessions
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Daily Input - Brain Dump */}
          <Card className="md:col-span-2 border-0 bg-white/80 shadow-lg shadow-zinc-200/50 backdrop-blur dark:bg-zinc-900/80 dark:shadow-zinc-950/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Brain className="h-5 w-5 text-primary" />
                Daily Brain Dump
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="What's on your mind today? Dump all your thoughts, tasks, ideas here..."
                className="min-h-[140px] resize-none border-zinc-200/60 bg-zinc-50/50 text-base leading-relaxed placeholder:text-muted-foreground/60 focus:border-primary/30 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-950/50"
                value={dailyInput}
                onChange={(e) => setDailyInput(e.target.value)}
              />
              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>{dailyInput.length} characters</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:text-primary/80"
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  AI Analyze
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Character Companion */}
          <Card className="border-0 bg-white/80 shadow-lg shadow-zinc-200/50 backdrop-blur dark:bg-zinc-900/80 dark:shadow-zinc-950/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">
                Your Companion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 p-8">
                {/* Placeholder Character */}
                <div className="relative mb-4">
                  <div className="h-24 w-24 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center animate-pulse">
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/30 to-primary/60 flex items-center justify-center">
                      <span className="text-3xl">🤖</span>
                    </div>
                  </div>
                  <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-green-500 border-2 border-white dark:border-zinc-900" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Ready to help you stay focused
                </p>
                <div className="mt-4 flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Focus Mode Tasks */}
          <Card className="border-0 bg-white/80 shadow-lg shadow-zinc-200/50 backdrop-blur dark:bg-zinc-900/80 dark:shadow-zinc-950/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Target className="h-5 w-5 text-orange-500" />
                Focus Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="What's your focus task?"
                  className="border-zinc-200/60 bg-zinc-50/50 focus:border-primary/30 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-950/50"
                  value={focusTask}
                  onChange={(e) => setFocusTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                />
                <Button onClick={addTask} size="icon" className="shrink-0">
                  +
                </Button>
              </div>

              {/* Task List */}
              <div className="mt-4 space-y-2">
                {tasks.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground/60">
                    Add a task to start your focus session
                  </p>
                ) : (
                  tasks.map((task, i) => (
                    <button
                      key={i}
                      onClick={() => toggleTask(i)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                        task.done
                          ? "bg-green-50 dark:bg-green-950/20"
                          : "bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {task.done ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                      )}
                      <span
                        className={`text-sm ${
                          task.done
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        }`}
                      >
                        {task.text}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {tasks.length > 0 && (
                <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <span className="text-xs text-muted-foreground">
                    {tasks.filter((t) => t.done).length}/{tasks.length} completed
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setTasks(tasks.filter((t) => !t.done))}
                  >
                    Clear done
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-sm text-muted-foreground/60">
          Screen capture coming soon • GPT-4o Vision powered
        </footer>
      </div>
    </div>
  );
}
