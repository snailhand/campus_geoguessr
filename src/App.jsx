import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Vibe & Connect's Campus GeoGuessr
 * Single-file React host app for running a photo-based "GeoGuessr-style" game.
 *
 * Quick fix notes (why images might not show):
 * - You must use the **Add Rounds** button or **drag & drop** onto the stage (now supported).
 * - The stage starts blurred until you press **Start** or toggle **Preview Unblur**.
 * - If you reloaded the page, object URLs from a previous session won't persist; re-add images.
 */

// ---------- Utilities ----------
const pad2 = (n) => String(n).padStart(2, "0");

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

// ---------- Core Types ----------
const makeRound = (overrides = {}) => ({
  id: crypto.randomUUID(),
  imageUrl: "",
  imageName: "",
  answer: "",
  hints: ["", "", ""],
  reveal: { hint1: false, hint2: false, hint3: false, answer: false },
  ...overrides,
});

const defaultTeams = [
  { id: "A", name: "Team A", score: 0 },
  { id: "B", name: "Team B", score: 0 },
  { id: "C", name: "Team C", score: 0 },
  { id: "D", name: "Team D", score: 0 },
];

// ---------- Main Component ----------
export default function App() {
  const [rounds, setRounds] = useLocalStorage("pg_rounds_v1", []);
  const [current, setCurrent] = useLocalStorage("pg_current_v1", 0);
  const [teams, setTeams] = useLocalStorage("pg_teams_v1", defaultTeams);

  const [duration, setDuration] = useLocalStorage("pg_timer_v1", 60); // seconds
  const [autoUnblur, setAutoUnblur] = useLocalStorage("pg_autoblur_v1", true);
  const [startBlur, setStartBlur] = useLocalStorage("pg_startblur_v1", 18); // px
  const [initialZoom, setInitialZoom] = useLocalStorage("pg_initialzoom_v1", 2.0); // zoom multiplier
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUnblur, setPreviewUnblur] = useState(false);
  const [toast, setToast] = useState("");

  const fileRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    if (!isRunning) return;
    const t0 = performance.now() - elapsed * 1000;
    tickRef.current = requestAnimationFrame(function loop(ts) {
      const e = Math.max(0, (ts - t0) / 1000);
      setElapsed(Math.min(e, duration));
      if (e < duration) {
        tickRef.current = requestAnimationFrame(loop);
      } else {
        setIsRunning(false);
      }
    });
    return () => cancelAnimationFrame(tickRef.current);
  }, [isRunning, duration]);

  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const activeRound = rounds[current] || null;
  const liveBlur = previewUnblur ? 0 : autoUnblur ? Math.round((1 - progress) * startBlur) : startBlur;

  // Zoom calculation: starts at 200% (2.0) when timer starts, gradually zooms out to 100% (1.0)
  const liveZoom = previewUnblur ? 1.0 : (isRunning && autoUnblur) ? 1.0 + ((initialZoom - 1) * (1 - progress)) : (elapsed > 0 ? 1.0 : initialZoom);
  
  const openFiles = () => fileRef.current?.click();
  const handleAddRounds = (files) => {
    if (!files || files.length === 0) return;
    const newRounds = Array.from(files).filter(Boolean).map((file) => {
      const url = URL.createObjectURL(file);
      return makeRound({ imageUrl: url, imageName: file.name });
    });
    setRounds((r) => [...r, ...newRounds]);
    // Auto-select: first added if list was empty, else jump to the first newly added
    setCurrent((idx) => (rounds.length === 0 ? 0 : rounds.length));
    setToast(`Added ${newRounds.length} round${newRounds.length > 1 ? "s" : ""}`);
    setTimeout(() => setToast(""), 2000);
  };

  const onDropStage = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) handleAddRounds(e.dataTransfer.files);
  };

  const updateRound = (id, patch) => {
    setRounds((arr) => arr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const resetReveals = (id) => updateRound(id, { reveal: { hint1: false, hint2: false, hint3: false, answer: false } });

  const startRound = () => {
    setElapsed(0);
    setIsRunning(true);
    if (activeRound) resetReveals(activeRound.id);
  };
  const pauseRound = () => setIsRunning(false);

  const reveal = (key) => {
    if (!activeRound) return;
    const currentReveal = activeRound.reveal[key];
    updateRound(activeRound.id, { reveal: { ...activeRound.reveal, [key]: !currentReveal } });
  };

  const nextRound = () => {
    setIsRunning(false);
    setElapsed(0);
    setCurrent((i) => Math.min(i + 1, Math.max(0, rounds.length - 1)));
  };
  const prevRound = () => {
    setIsRunning(false);
    setElapsed(0);
    setCurrent((i) => Math.max(i - 1, 0));
  };

  const setTeamScore = (idx, delta) => {
    setTeams((ts) => ts.map((t, i) => (i === idx ? { ...t, score: Math.max(0, t.score + delta) } : t)));
  };
  const renameTeam = (idx, name) => setTeams((ts) => ts.map((t, i) => (i === idx ? { ...t, name } : t)));
  const resetScores = () => setTeams((ts) => ts.map((t) => ({ ...t, score: 0 })));

  // Delete round functionality
  const deleteRound = (id) => {
    setRounds((arr) => arr.filter((r) => r.id !== id));
    // Adjust current index if needed
    setCurrent((idx) => {
      const newLength = rounds.length - 1;
      if (newLength === 0) return 0;
      if (idx >= newLength) return newLength - 1;
      return idx;
    });
    setToast("Round deleted");
    setTimeout(() => setToast(""), 2000);
  };

  // Participant view functionality
  const openParticipantView = () => {
    if (!activeRound?.imageUrl) {
      setToast("No active round to display");
      setTimeout(() => setToast(""), 2000);
      return;
    }
    
    const participantWindow = window.open('', 'participantView', 'width=1200,height=800,scrollbars=no,resizable=yes');
    
    participantWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Campus GeoGuessr - Participant View</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            body { margin: 0; padding: 0; overflow: hidden; }
            .participant-timer { 
              position: fixed; 
              top: 20px; 
              right: 20px; 
              z-index: 10; 
              background: rgba(0,0,0,0.8); 
              color: white; 
              padding: 10px 15px; 
              border-radius: 10px; 
              font-family: monospace; 
              font-size: 24px; 
              font-weight: bold; 
            }
            .participant-image { 
              width: 100vw; 
              height: 100vh; 
              object-fit: cover; 
              filter: blur(${liveBlur}px); 
              transform: scale(${liveZoom});
              transition: transform 0.3s ease-out;
            }
            .participant-hints {
              position: fixed;
              top: 20px;
              left: 20px;
              z-index: 10;
              max-width: 400px;
            }
            .participant-hint {
              background: rgba(0,0,0,0.8);
              color: white;
              padding: 8px 12px;
              margin: 5px 0;
              border-radius: 6px;
              font-size: 14px;
            }
            .participant-answer {
              background: rgba(34,197,94,0.9);
              color: white;
              padding: 8px 12px;
              margin: 5px 0;
              border-radius: 6px;
              font-size: 14px;
              font-weight: bold;
            }
            .participant-center-answer {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              z-index: 15;
              pointer-events: none;
            }
            .participant-answer-center {
              background: rgba(34, 197, 94, 0.95);
              color: white;
              padding: 12px 24px;
              border-radius: 12px;
              font-size: 18px;
              font-weight: bold;
              text-align: center;
              box-shadow: 0 4px 20px rgba(0,0,0,0.5);
              border: 2px solid rgba(34, 197, 94, 0.8);
              backdrop-filter: blur(10px);
            }
          </style>
        </head>
        <body>
          <img src="${activeRound.imageUrl}" alt="${activeRound.imageName || 'Round'}" class="participant-image" id="participantImage" />
          
          <div class="participant-timer" id="participantTimer">
            ${Math.floor((duration - elapsed) / 60)}:${String(Math.floor((duration - elapsed) % 60)).padStart(2, '0')}
          </div>
          
          <div class="participant-hints" id="participantHints">
            ${activeRound.reveal.hint1 && activeRound.hints[0] ? `<div class="participant-hint">Hint 1: ${activeRound.hints[0]}</div>` : ''}
            ${activeRound.reveal.hint2 && activeRound.hints[1] ? `<div class="participant-hint">Hint 2: ${activeRound.hints[1]}</div>` : ''}
            ${activeRound.reveal.hint3 && activeRound.hints[2] ? `<div class="participant-hint">Hint 3: ${activeRound.hints[2]}</div>` : ''}
          </div>
          
          <!-- Center answer display -->
          <div class="participant-center-answer" id="participantCenterAnswer">
            ${activeRound.reveal.answer && activeRound.answer ? `
              <div class="participant-answer-center">
                ${activeRound.answer}
              </div>
            ` : ''}
          </div>
          
          <script>
            // Sync with parent window
            let lastUpdate = Date.now();
            
            function updateParticipantView() {
              try {
                if (window.opener && !window.opener.closed) {
                  const parentData = window.opener.getParticipantData && window.opener.getParticipantData();
                  if (parentData) {
                    document.getElementById('participantImage').style.filter = 'blur(' + parentData.blur + 'px)';
                    document.getElementById('participantImage').style.transform = 'scale(' + parentData.zoom + ')';

                    document.getElementById('participantTimer').textContent = 
                      Math.floor(parentData.remaining / 60) + ':' + String(Math.floor(parentData.remaining % 60)).padStart(2, '0');
                    
                    // Update hints
                    let hintsHtml = '';
                    if (parentData.reveal.hint1 && parentData.hints[0]) {
                      hintsHtml += '<div class="participant-hint">Hint 1: ' + parentData.hints[0] + '</div>';
                    }
                    if (parentData.reveal.hint2 && parentData.hints[1]) {
                      hintsHtml += '<div class="participant-hint">Hint 2: ' + parentData.hints[1] + '</div>';
                    }
                    if (parentData.reveal.hint3 && parentData.hints[2]) {
                      hintsHtml += '<div class="participant-hint">Hint 3: ' + parentData.hints[2] + '</div>';
                    }
                    document.getElementById('participantHints').innerHTML = hintsHtml;

                    // Update center answer
                    const centerAnswerHtml = parentData.reveal.answer && parentData.answer 
                      ? '<div class="participant-answer-center">' + parentData.answer + '</div>'
                      : '';
                    document.getElementById('participantCenterAnswer').innerHTML = centerAnswerHtml;
                  }
                }
              } catch (e) {
                // Parent window closed or blocked
              }
            }
            
            // Update every 100ms for smooth sync
            setInterval(updateParticipantView, 100);
            
            // Handle window close
            window.addEventListener('beforeunload', function() {
              if (window.opener && !window.opener.closed) {
                window.opener.setParticipantViewClosed && window.opener.setParticipantViewClosed();
              }
            });
          </script>
        </body>
      </html>
    `);
    
    participantWindow.document.close();
    setToast("Participant view opened");
    setTimeout(() => setToast(""), 2000);
  };

  // Export / Import (note: object URLs won't persist after reload; reattach images)
  const exportPack = () => {
    const payload = {
      meta: { name: "ProjectorGeoGuess Pack", version: 1, exportedAt: new Date().toISOString() },
      rounds: rounds.map((r) => ({
        imageName: r.imageName,
        imageUrl: r.imageUrl,
        answer: r.answer,
        hints: r.hints,
      })),
      teams,
      settings: { duration, autoUnblur, startBlur },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `projector-geoguess-pack-${Date.now()}.json`;
    a.click();
  };

  const importPack = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const obj = JSON.parse(String(e.target?.result || "{}"));
        if (obj?.rounds) {
          const mapped = obj.rounds.map((r) => makeRound({
            imageUrl: r.imageUrl || "",
            imageName: r.imageName || "",
            answer: r.answer || "",
            hints: r.hints || ["", "", ""],
          }));
          setRounds(mapped);
          setCurrent(0);
        }
        if (obj?.teams) setTeams(obj.teams);
        if (obj?.settings) {
          setDuration(obj.settings.duration ?? 60);
          setAutoUnblur(!!obj.settings.autoUnblur);
          setStartBlur(obj.settings.startBlur ?? 18);
        }
      } catch (err) {
        alert("Import failed: invalid JSON");
      }
    };
    reader.readAsText(file);
  };

  // Helper functions for participant view sync
  const getParticipantData = () => {
    if (!activeRound) return null;
    const remaining = Math.max(0, Math.round(duration - elapsed));
      return {
      blur: liveBlur,
      zoom: liveZoom,
      remaining: remaining,
      reveal: activeRound.reveal,
      hints: activeRound.hints,
      answer: activeRound.answer
    };
  };

  const setParticipantViewClosed = () => {
    setToast("Participant view closed");
    setTimeout(() => setToast(""), 2000);
  };

  // Make functions available globally for participant window
  useEffect(() => {
    window.getParticipantData = getParticipantData;
    window.setParticipantViewClosed = setParticipantViewClosed;
    return () => {
      delete window.getParticipantData;
      delete window.setParticipantViewClosed;
    };
  }, [activeRound, liveBlur, elapsed, duration]);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100">
      {/* hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleAddRounds(e.target.files)}
      />

      <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">
        <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Campus GeoGuessr</h1>
          </div>
          <div>
            <p className="text-sm text-slate-400">
              Click on 'Add Rounds' to upload photos, 
              'Start' to run a timer that auto‑unblurs the image,
              'Participant view' to open a new window with the current round image</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={openFiles} className="rounded-xl bg-slate-800/60 px-3 py-2 text-sm hover:bg-slate-700/60">
              Add Rounds
            </button>
            <button 
              onClick={() => {
                setRounds([]);
                setCurrent(0);
                setToast("All rounds cleared");
                setTimeout(() => setToast(""), 2000);
              }}
              className="rounded-xl bg-red-800/60 px-3 py-2 text-sm hover:bg-red-700/60"
              disabled={rounds.length === 0}
            >
              Clear all rounds
            </button>
            <button 
              onClick={openParticipantView}
              className="rounded-xl bg-blue-800/60 px-3 py-2 text-sm hover:bg-blue-700/60"
              disabled={!activeRound}
              title="Open participant view in new window"
            >
              Participant view
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: Stage */}
          <div className="lg:col-span-2">
            <div
              className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900 shadow-xl ring-1 ring-white/10"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropStage}
              title="Tip: drag & drop images here"
            >
              {activeRound?.imageUrl ? (
                <img
                  src={activeRound.imageUrl}
                  alt={activeRound.imageName || "round"}
                  className="h-full w-full object-cover"
                  style={{ 
                    filter: `blur(${liveBlur}px)`,
                    transform: `scale(${liveZoom})`,
                    transition: 'transform 0.3s ease-out'
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  <div className="text-center">
                    <p className="text-lg font-semibold">No round loaded</p>
                    <p className="text-sm">Click <span className="font-semibold">Add Rounds</span> or drag & drop images onto this box</p>
                  </div>
                </div>
              )}

              {/* Timer / progress overlay */}
              <TimerOverlay isRunning={isRunning} elapsed={elapsed} duration={duration} />

              {/* Bottom bar controls */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={startRound}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-50"
                    disabled={!activeRound}
                    title="Start Timer"
                  >
                    Start
                  </button>
                  <button
                    onClick={pauseRound}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium hover:bg-amber-500 disabled:pointer-events-none disabled:opacity-50"
                    disabled={!isRunning}
                    title="Pause Timer"
                  >
                    Pause
                  </button>
                  <button
                    onClick={() => setElapsed(0)}
                    className="rounded-lg bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
                    title="Reset Timer"
                  >
                   Reset
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewUnblur((v) => !v)}
                    className={`rounded-lg px-3 py-2 text-xs ${previewUnblur ? "bg-indigo-600 hover:bg-indigo-500" : "bg-slate-800/80 hover:bg-slate-700/80"}`}
                    disabled={!activeRound}
                  >
                    {previewUnblur ? "Preview: Unblurred" : "Preview Unblur"}
                  </button>

                  <button
                    onClick={() => reveal("hint1")}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      activeRound?.reveal.hint1 
                        ? "bg-emerald-600/80 hover:bg-emerald-500/80" 
                        : "bg-slate-800/80 hover:bg-slate-700/80"
                    }`}
                    disabled={!activeRound}
                  >
                    Hint 1
                  </button>
                  <button
                    onClick={() => reveal("hint2")}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      activeRound?.reveal.hint2 
                        ? "bg-emerald-600/80 hover:bg-emerald-500/80" 
                        : "bg-slate-800/80 hover:bg-slate-700/80"
                    }`}
                    disabled={!activeRound}
                  >
                    Hint 2
                  </button>
                  <button
                    onClick={() => reveal("hint3")}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      activeRound?.reveal.hint3 
                        ? "bg-emerald-600/80 hover:bg-emerald-500/80" 
                        : "bg-slate-800/80 hover:bg-slate-700/80"
                    }`}
                    disabled={!activeRound}
                  >
                    Hint 3
                  </button>
                  <button
                    onClick={() => reveal("answer")}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                      activeRound?.reveal.answer 
                        ? "bg-indigo-600/80 hover:bg-indigo-500/80" 
                        : "bg-slate-800/80 hover:bg-slate-700/80"
                    }`}
                    disabled={!activeRound}
                  >
                    Answer
                  </button>
                </div>
              </div>

              {/* Top-left labels (hints when revealed) */}
              {activeRound && (
                <div className="absolute left-3 top-3 space-y-1">
                  {activeRound.reveal.hint1 && activeRound.hints[0] && (
                    <Badge label={`Hint 1: ${activeRound.hints[0]}`} />
                  )}
                  {activeRound.reveal.hint2 && activeRound.hints[1] && (
                    <Badge label={`Hint 2: ${activeRound.hints[1]}`} />
                  )}
                  {activeRound.reveal.hint3 && activeRound.hints[2] && (
                    <Badge label={`Hint 3: ${activeRound.hints[2]}`} />
                  )}
                </div>
              )}
              {/* Center answer display */}
              {activeRound && activeRound.reveal.answer && activeRound.answer && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-emerald-600/95 text-white px-6 py-3 rounded-xl text-lg font-bold shadow-2xl border-2 border-emerald-400/50 backdrop-blur-sm">
                    {activeRound.answer}
                  </div>
                </div>
              )}
              {/* Toast */}
              {toast && (
                <div className="absolute right-3 bottom-24 rounded-lg bg-black/70 px-3 py-2 text-xs">
                  {toast}
                </div>
              )}
            </div>

            {/* Scoreboard */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Scoreboard</h2>
                <button onClick={resetScores} className="rounded-lg bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700">Reset</button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {teams.map((t, i) => (
                  <div key={t.id} className="rounded-xl bg-slate-800/60 p-3">
                    <input
                      value={t.name}
                      onChange={(e) => renameTeam(i, e.target.value)}
                      className="mb-2 w-full rounded-lg bg-slate-900/60 px-2 py-1 text-sm outline-none"
                    />
                    <div className="mb-2 text-3xl font-black tabular-nums">{t.score}</div>
                    <div className="flex flex-wrap gap-1">
                      {[+1, +2, +3, -1].map((d) => (
                        <button
                          key={d}
                          onClick={() => setTeamScore(i, d)}
                          className="rounded-md bg-slate-700/80 px-2 py-1 text-xs hover:bg-slate-600/80"
                        >
                          {d > 0 ? `+${d}` : d}
                        </button>
                      ))}
                      <CustomDelta onApply={(n) => setTeamScore(i, n)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Rounds + Settings */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow">
              <h2 className="mb-3 text-lg font-semibold">Rounds</h2>
              {rounds.length === 0 ? (
                <p className="text-sm text-slate-400">No rounds yet. Use <span className="font-semibold">Add Rounds</span> or drop images onto the stage.</p>
              ) : (
                <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                  {rounds.map((r, idx) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-3 rounded-xl p-2 ${
                        idx === current ? "ring-2 ring-indigo-500/70" : "border border-white/10"
                      }`}
                    >
                      <button
                        onClick={() => setCurrent(idx)}
                        className="flex flex-1 items-center gap-3 text-left hover:bg-slate-800/70 rounded-lg p-1"
                      >
                        <div className="h-12 w-16 overflow-hidden rounded-lg bg-slate-800">
                          {r.imageUrl ? (
                            <img src={r.imageUrl} alt={r.imageName} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No image</div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium line-clamp-1">{r.imageName || "Untitled Round"}</div>
                          <div className="text-xs text-slate-400 line-clamp-1">{r.answer ? `Answer: ${r.answer}` : "No answer set"}</div>
                        </div>
                        <div className="text-xs text-slate-400">{idx + 1}</div>
                      </button>
                      <button
                        onClick={() => deleteRound(r.id)}
                        className="rounded-lg bg-red-600/80 px-2 py-1 text-xs hover:bg-red-500/80 text-white"
                        title="Delete this round"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow">
              <h2 className="mb-3 text-lg font-semibold">Editor (current round)</h2>
              {activeRound ? (
                <RoundEditor round={activeRound} updateRound={updateRound} />
              ) : (
                <p className="text-sm text-slate-400">Select a round to edit.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow">
              <h2 className="mb-3 text-lg font-semibold">Timer, Blur & Zoom</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm text-slate-300">Round duration (sec)</label>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={duration}
                    onChange={(e) => setDuration(Math.max(10, Math.min(300, Number(e.target.value) || 60)))}
                    className="w-28 rounded-lg bg-slate-800 px-2 py-1 text-right"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm text-slate-300">Auto un-blur over timer</label>
                  <input type="checkbox" checked={autoUnblur} onChange={(e) => setAutoUnblur(e.target.checked)} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm text-slate-300">Starting blur (px)</label>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={startBlur}
                    onChange={(e) => setStartBlur(Number(e.target.value))}
                    className="w-48"
                  />
                  <span className="text-xs text-slate-400 w-8 text-right">{startBlur}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm text-slate-300">Starting zoom (x)</label>
                  <input
                    type="range"
                    min={1.0}
                    max={3.0}
                    step={0.1}
                    value={initialZoom}
                    onChange={(e) => setInitialZoom(Number(e.target.value))}
                    className="w-48"
                  />
                  <span className="text-xs text-slate-400 w-8 text-right">{liveZoom}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-6 text-center text-xs text-slate-500">
          Try not to reload the page as it will reset the image URLs (object URLs are session-based).
        </footer>
      </div>
    </div>
  );
}

function Badge({ label, variant = "neutral" }) {
  const cls =
    variant === "success"
      ? "bg-emerald-600/90 ring-emerald-400/50"
      : variant === "warn"
      ? "bg-amber-600/90 ring-amber-400/50"
      : "bg-slate-800/90 ring-white/10";
  return (
    <div className={`inline-block rounded-lg px-2 py-1 text-xs font-medium ring-1 ${cls}`}>{label}</div>
  );
}

function TimerOverlay({ isRunning, elapsed, duration }) {
  const remaining = Math.max(0, Math.round(duration - elapsed));
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const pct = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;

  return (
    <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
      <div className="relative h-10 w-10">
        <svg viewBox="0 0 36 36" className="h-10 w-10">
          <path
            className="opacity-20"
            d="M18 2 a 16 16 0 1 1 0 32 a 16 16 0 1 1 0 -32"
            fill="none"
            stroke="white"
            strokeWidth="3"
          />
          <path
            d="M18 2 a 16 16 0 1 1 0 32 a 16 16 0 1 1 0 -32"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeDasharray={`${Math.round(pct * 100)}, 100`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums">
          {pad2(mm)}:{pad2(ss)}
        </div>
      </div>
      {!isRunning && (
        <span className="rounded-md bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wider">Paused</span>
      )}
    </div>
  );
}

function CustomDelta({ onApply }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(5);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded-md bg-slate-700/80 px-2 py-1 text-xs hover:bg-slate-600/80">
        Custom
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-white/10 bg-slate-900 p-2 shadow-xl">
          <div className="mb-2 text-xs text-slate-300">Add/subtract points</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={val}
              onChange={(e) => setVal(Number(e.target.value) || 0)}
              className="w-20 rounded-md bg-slate-800 px-2 py-1 text-right text-sm"
            />
            <button
              onClick={() => {
                onApply(Number(val) || 0);
                setOpen(false);
              }}
              className="rounded-md bg-indigo-600 px-2 py-1 text-xs hover:bg-indigo-500"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoundEditor({ round, updateRound }) {
  const [local, setLocal] = useState(round);
  useEffect(() => setLocal(round), [round.id]);

  useEffect(() => {
    // live patching
    updateRound(round.id, local);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.answer, local.hints, local.imageUrl, local.imageName]);

  const onPickImage = (file) => {
    const url = URL.createObjectURL(file);
    setLocal((r) => ({ ...r, imageUrl: url, imageName: file.name }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="h-20 w-32 overflow-hidden rounded-lg border border-white/10 bg-slate-800">
          {local.imageUrl ? (
            <img src={local.imageUrl} alt={local.imageName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No image</div>
          )}
        </div>
        <div className="flex-1">
          <div className="mb-2 text-xs text-slate-400">Change image</div>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files && onPickImage(e.target.files[0])}
            className="block w-full text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm">Answer (what/where)</label>
        <input
          value={local.answer}
          onChange={(e) => setLocal((r) => ({ ...r, answer: e.target.value }))}
          placeholder="location"
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <label className="mb-1 block text-sm">Hint {i + 1}</label>
            <input
              value={local.hints[i]}
              onChange={(e) => {
                const arr = [...local.hints];
                arr[i] = e.target.value;
                setLocal((r) => ({ ...r, hints: arr }));
              }}
              placeholder={i === 0 ? "one" : i === 1 ? "two" : "three"}
              className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => setLocal((r) => ({ ...r, reveal: { hint1: false, hint2: false, hint3: false, answer: false } }))}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
        >
          Reset reveals
        </button>
      </div>
    </div>
  );
}
