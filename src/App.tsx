\
import React, { useEffect, useMemo, useRef, useState } from "react";
import LZString from "lz-string";

type Task = {
  id: string;
  name: string;
  start: string; // 'YYYY-MM-DD'
  end: string;   // 'YYYY-MM-DD'
  color?: string;
  deps: string[]; // predecessor IDs
};

type DragState =
  | null
  | {
      id: string;
      kind: "move" | "resize-left" | "resize-right";
      startX: number;
      origStart: string;
      origEnd: string;
    };

type ZoomKey = "day" | "week" | "month";
const ROW_HEIGHT = 40;
const BAR_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const ZOOMS: Record<ZoomKey, number> = { day: 24, week: 10, month: 4 };

function parseDate(d: string): Date { return new Date(d + "T00:00:00"); }
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function diffInDays(a: Date, b: Date): number {
  const ms = parseDate(fmt(a)).getTime() - parseDate(fmt(b)).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
function clampDateStr(s: string, min: string, max: string): string {
  const d = parseDate(s).getTime();
  const lo = parseDate(min).getTime();
  const hi = parseDate(max).getTime();
  if (d < lo) return min;
  if (d > hi) return max;
  return s;
}
function uid(){ return Math.random().toString(36).slice(2,9).toUpperCase(); }

function useLocalStorageState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState] as const;
}

const defaultTasks: Task[] = [
  { id: "P",   name: "プロジェクト起案", start: fmt(addDays(new Date(), -3)), end: fmt(addDays(new Date(), 2)),  color: "#60a5fa", deps: [] },
  { id: "D1",  name: "要件定義",         start: fmt(addDays(new Date(), 3)),  end: fmt(addDays(new Date(), 10)), color: "#34d399", deps: ["P"] },
  { id: "D2",  name: "設計",             start: fmt(addDays(new Date(), 11)), end: fmt(addDays(new Date(), 18)), color: "#fbbf24", deps: ["D1"] },
  { id: "IMP", name: "実装",             start: fmt(addDays(new Date(), 19)), end: fmt(addDays(new Date(), 30)), color: "#f87171", deps: ["D2"] },
  { id: "REV", name: "レビュー & 調整",  start: fmt(addDays(new Date(), 31)), end: fmt(addDays(new Date(), 36)), color: "#a78bfa", deps: ["IMP"] },
];

function topoSort(tasks: Task[]): string[] {
  const ids = tasks.map((t) => t.id);
  const graph = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  tasks.forEach((t) => {
    t.deps.forEach((p) => {
      if (graph.has(p)) {
        graph.get(p)!.push(t.id);
        indeg.set(t.id, (indeg.get(t.id) || 0) + 1);
      }
    });
  });
  const q: string[] = [];
  indeg.forEach((deg, id) => { if (deg === 0) q.push(id); });
  const out: string[] = [];
  while (q.length) {
    const x = q.shift()!;
    out.push(x);
    (graph.get(x) || []).forEach((n) => {
      indeg.set(n, (indeg.get(n) || 0) - 1);
      if (indeg.get(n) === 0) q.push(n);
    });
  }
  return out.length === ids.length ? out : ids;
}

export default function App() {
  const [tasks, setTasks] = useLocalStorageState<Task[]>("mini-gantt/tasks", defaultTasks);
  const [zoom, setZoom] = useLocalStorageState<ZoomKey>("mini-gantt/zoom", "day");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);

  const didLoadFromHashRef = useRef(false);
  useEffect(() => {
    if (didLoadFromHashRef.current) return;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const enc = params.get("d");
    if (enc) {
      try {
        const json = LZString.decompressFromEncodedURIComponent(enc);
        const arr = JSON.parse(json || "[]");
        if (Array.isArray(arr)) setTasks(arr);
      } catch {}
    }
    didLoadFromHashRef.current = true;
  }, [setTasks]);

  const [minDateStr, maxDateStr] = useMemo(() => {
    if (tasks.length === 0) {
      const today = fmt(new Date());
      return [today, fmt(addDays(new Date(), 30))];
    }
    const min = tasks.reduce((acc, t) => (parseDate(t.start) < acc ? parseDate(t.start) : acc), parseDate(tasks[0].start));
    const max = tasks.reduce((acc, t) => (parseDate(t.end) > acc ? parseDate(t.end) : acc), parseDate(tasks[0].end));
    return [fmt(addDays(min, -7)), fmt(addDays(max, 21))];
  }, [tasks]);

  const minDate = parseDate(minDateStr);
  const maxDate = parseDate(maxDateStr);
  const totalDays = Math.max(1, diffInDays(maxDate, minDate));
  const dayWidth = ZOOMS[zoom];

  function dateToX(s: string) { return diffInDays(parseDate(s), minDate) * dayWidth; }
  function xToDate(x: number) { return fmt(addDays(minDate, Math.round(x / dayWidth))); }

  const violations = useMemo(() => {
    const map = new Set<string>();
    const idToTask = new Map(tasks.map((t) => [t.id, t]));
    tasks.forEach((t) => {
      const latestEnd = t.deps.reduce((acc, pid) => {
        const p = idToTask.get(pid);
        if (!p) return acc;
        const pend = parseDate(p.end);
        return pend > acc ? pend : acc;
      }, new Date(0));
      if (latestEnd.getTime() > 0 && parseDate(t.start) < latestEnd) map.add(t.id);
    });
    return map;
  }, [tasks]);

  const onMouseDownBar = (e: React.MouseEvent, id: string, kind: DragState["kind"]) => {
    e.stopPropagation();
    const task = tasks.find((t) => t.id === id)!;
    setSelectedId(id);
    setDrag({ id, kind, startX: e.clientX, origStart: task.start, origEnd: task.end });
  };

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const ddays = Math.round(dx / dayWidth);
      setTasks((prev) => prev.map((t) => {
        if (t.id !== drag.id) return t;
        if (drag.kind === "move") {
          const span = diffInDays(parseDate(drag.origEnd), parseDate(drag.origStart));
          let ns = xToDate(dateToX(drag.origStart) + ddays * dayWidth);
          let ne = fmt(addDays(parseDate(ns), span));
          ns = clampDateStr(ns, minDateStr, maxDateStr);
          ne = clampDateStr(ne, minDateStr, maxDateStr);
          return { ...t, start: ns, end: ne };
        } else if (drag.kind === "resize-left") {
          let ns = xToDate(dateToX(drag.origStart) + ddays * dayWidth);
          let ne = drag.origEnd;
          if (parseDate(ns) >= addDays(parseDate(ne), -1)) ns = fmt(addDays(parseDate(ne), -1));
          ns = clampDateStr(ns, minDateStr, maxDateStr);
          return { ...t, start: ns };
        } else {
          let ne = xToDate(dateToX(drag.origEnd) + ddays * dayWidth);
          let ns = drag.origStart;
          if (parseDate(ne) <= addDays(parseDate(ns), 1)) ne = fmt(addDays(parseDate(ns), 1));
          ne = clampDateStr(ne, minDateStr, maxDateStr);
          return { ...t, end: ne };
        }
      }));
    }
    function onUp() { setDrag(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, dayWidth, minDateStr, maxDateStr, setTasks]);

  function addTask() {
    const start = fmt(addDays(new Date(), 1));
    const end = fmt(addDays(new Date(), 4));
    const newTask: Task = { id: uid(), name: "新規タスク", start, end, color: randomPalette(), deps: [] };
    setTasks((prev) => [...prev, newTask]);
    setSelectedId(newTask.id);
  }
  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id).map((t) => ({ ...t, deps: t.deps.filter((d) => d !== id) })));
    if (selectedId === id) setSelectedId(null);
  }
  function importJSON(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = JSON.parse(String(reader.result)) as Task[];
        if (!Array.isArray(next)) throw new Error();
        setTasks(next.map((t) => ({
          id: String(t.id),
          name: String(t.name),
          start: fmt(parseDate(t.start)),
          end: fmt(parseDate(t.end)),
          color: t.color || randomPalette(),
          deps: Array.isArray(t.deps) ? t.deps.map(String) : []
        })));
      } catch { alert("JSONの形式が不正です"); }
    };
    reader.readAsText(file);
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "gantt-data.json"; a.click();
    URL.revokeObjectURL(url);
  }
  function toggleDep(from: string, to: string) {
    if (from === to) return;
    setTasks((prev) => prev.map((t) => {
      if (t.id !== to) return t;
      const has = t.deps.includes(from);
      return { ...t, deps: has ? t.deps.filter((d) => d !== from) : [...t.deps, from] };
    }));
  }
  function autoSchedule() {
    const order = topoSort(tasks);
    const idToTask = new Map(tasks.map((t) => [t.id, t]));
    const next: Task[] = tasks.map((t) => ({ ...t }));
    const nextMap = new Map(next.map((t) => [t.id, t]));
    order.forEach((id) => {
      const t = nextMap.get(id)!;
      const duration = diffInDays(parseDate(t.end), parseDate(t.start));
      const latestEnd = t.deps.reduce((acc, pid) => {
        const p = nextMap.get(pid) || idToTask.get(pid);
        if (!p) return acc;
        const pend = parseDate(p.end);
        return pend > acc ? pend : acc;
      }, parseDate(t.start));
      if (latestEnd > parseDate(t.start)) {
        const ns = fmt(addDays(latestEnd, 0));
        const ne = fmt(addDays(latestEnd, duration));
        t.start = clampDateStr(ns, minDateStr, maxDateStr);
        t.end = clampDateStr(ne, minDateStr, maxDateStr);
      }
    });
    setTasks(next);
  }
  function randomPalette() {
    const palettes = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185", "#22d3ee", "#84cc16"];
    return palettes[Math.floor(Math.random() * palettes.length)];
  }
  function makeShareURL(): string {
    const json = JSON.stringify(tasks);
    const enc = LZString.compressToEncodedURIComponent(json);
    const url = new URL(window.location.href);
    url.hash = `d=${enc}`;
    return url.toString();
  }
  async function copyShareURL() {
    const url = makeShareURL();
    try { await navigator.clipboard.writeText(url); alert("共有リンクをコピーしました"); }
    catch { prompt("コピーできない場合は手動でコピーしてください:", url); }
  }

  const daysArr = useMemo(() => new Array(Math.max(1, diffInDays(maxDate, minDate)) + 1).fill(0).map((_, i) => addDays(minDate, i)), [minDate, maxDate]);
  const selected = tasks.find((t) => t.id === selectedId) || null;

  function TaskRow({ t, index }: { t: Task; index: number }) {
    const left = dateToX(t.start);
    const width = Math.max(1, dateToX(t.end) - dateToX(t.start));
    const top = HEADER_HEIGHT + index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const isSelected = selectedId === t.id;
    const isViolated = violations.has(t.id);
    return (
      <div className="absolute inset-0 pointer-events-none" style={{ top: 0, left: 0 }}>
        <div className="absolute left-0 right-0" style={{ top: HEADER_HEIGHT + index * ROW_HEIGHT, height: ROW_HEIGHT }} />
        <div
          className={`absolute rounded-md pointer-events-auto transition-shadow`}
          style={{ top, left, width, height: BAR_HEIGHT, background: t.color || "#60a5fa", boxShadow: isSelected ? "0 0 0 3px rgba(59,130,246,0.5)" : "none", outline: isViolated ? "2px solid #ef4444" : "none" }}
          onMouseDown={(e) => onMouseDownBar(e, t.id, "move")}
          onClick={(e) => { e.stopPropagation(); if (linkMode) { if (!linkingFrom) setLinkingFrom(t.id); else { toggleDep(linkingFrom, t.id); setLinkingFrom(null); } } else { setSelectedId(t.id); } }}
          title={`${t.name} (${t.start} → ${t.end})`}
        >
          <div className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-black/10" onMouseDown={(e) => onMouseDownBar(e, t.id, "resize-left")} />
          <div className="absolute inset-0 flex items-center px-2 text-xs text-black/80"><span className="truncate">{t.name}</span></div>
          <div className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/10" onMouseDown={(e) => onMouseDownBar(e, t.id, "resize-right")} />
          <div className="absolute -right-2 -top-2 w-4 h-4 rounded-full border border-white bg-black/20 cursor-crosshair" title="依存関係：この点からターゲットタスクをクリック" onClick={(e) => { e.stopPropagation(); setLinkMode(true); setLinkingFrom(t.id); }} />
        </div>
      </div>
    );
  }

  function DependencyArrows() {
    const idToIndex = new Map(tasks.map((t, i) => [t.id, i]));
    const paths: { key: string; d: string; violated: boolean }[] = [];
    tasks.forEach((to) => {
      to.deps.forEach((fromId) => {
        const from = tasks.find((x) => x.id === fromId);
        if (!from) return;
        const iFrom = idToIndex.get(from.id)!;
        const iTo = idToIndex.get(to.id)!;
        const x1 = dateToX(from.end);
        const y1 = HEADER_HEIGHT + iFrom * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x2 = dateToX(to.start);
        const y2 = HEADER_HEIGHT + iTo * ROW_HEIGHT + ROW_HEIGHT / 2;
        const mx = (x1 + x2) / 2;
        const d = `M ${x1},${y1} C ${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        const violated = parseDate(to.start) < parseDate(from.end);
        paths.push({ key: `${from.id}->${to.id}`, d, violated });
      });
    });
    return (
      <svg className="absolute inset-0 pointer-events-none" style={{ top: 0, left: 0 }}>
        {paths.map((p) => (<path key={p.key} d={p.d} fill="none" stroke={p.violated ? "#ef4444" : "#64748b"} strokeWidth={2} />))}
      </svg>
    );
  }

  return (
    <div className="w-screen h-screen flex text-gray-800">
      <aside className="w-[300px] border-r bg-white p-3 gap-3 flex flex-col">
        <h1 className="text-xl font-semibold">Mini Gantt（Online）</h1>
        <div className="flex gap-2 flex-wrap">
          <button className="px-3 py-1 rounded-md bg-blue-600 text-white shadow-soft" onClick={addTask}>＋ タスク</button>
          <button className="px-3 py-1 rounded-md bg-gray-100" onClick={() => { if(confirm('すべてのタスクを削除しますか？')) { localStorage.removeItem('mini-gantt/tasks'); location.reload(); }}}>全削除</button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">ズーム:</span>
          {(["day","week","month"] as ZoomKey[]).map((z) => (
            <button key={z} className={`px-2 py-1 rounded border ${zoom===z?"bg-gray-900 text-white":"bg-white"}`} onClick={() => setZoom(z)}>
              {z}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button className="px-3 py-1 rounded bg-emerald-600 text-white" onClick={autoSchedule}>自動調整</button>
        </div>

        <div className="mt-2 space-y-2">
          <div className="text-sm font-medium">共有・バックアップ</div>
          <div className="flex gap-2 flex-wrap">
            <button className="px-3 py-1 rounded bg-indigo-600 text-white" onClick={copyShareURL}>共有リンクをコピー</button>
            <button className="px-3 py-1 rounded bg-gray-100" onClick={() => {
              const url = makeShareURL();
              const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click();
            }}>共有リンクを新規タブで開く</button>
          </div>
          <div className="text-xs text-gray-500 leading-5">
            共有リンクはURLのハッシュ（#以降）に現在のデータを圧縮して埋め込みます。サーバ保存はありません。
          </div>
        </div>

        <div className="mt-2 space-y-2">
          <div className="text-sm font-medium">インポート / エクスポート</div>
          <div className="flex items-center gap-2">
            <label className="px-3 py-1 rounded bg-gray-100 cursor-pointer">
              JSONインポート
              <input type="file" className="hidden" accept=".json,application/json"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) importJSON(file); }}
              />
            </label>
            <button className="px-3 py-1 rounded bg-gray-100" onClick={exportJSON}>JSONエクスポート</button>
          </div>
        </div>

        {selected ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">選択タスク</div>
            <input className="w-full px-2 py-1 border rounded" value={selected.name} onChange={(e) => setTasks(tasks.map(t => t.id===selected.id ? {...t, name:e.target.value} : t))} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">開始日
                <input type="date" className="w-full mt-1 px-2 py-1 border rounded" value={selected.start}
                  onChange={(e) => setTasks(tasks.map(t => t.id===selected.id ? {...t, start: fmt(parseDate(e.target.value))} : t))}/>
              </label>
              <label className="text-xs">終了日
                <input type="date" className="w-full mt-1 px-2 py-1 border rounded" value={selected.end}
                  onChange={(e) => setTasks(tasks.map(t => t.id===selected.id ? {...t, end: fmt(parseDate(e.target.value))} : t))}/>
              </label>
            </div>
            <label className="text-xs">色
              <input type="color" className="w-full mt-1 h-10 border rounded" value={selected.color || "#60a5fa"}
                onChange={(e) => setTasks(tasks.map(t => t.id===selected.id ? {...t, color: e.target.value} : t))}/>
            </label>
            <div className="text-xs">依存関係（前提タスクID）</div>
            <div className="flex flex-wrap gap-2">
              {selected.deps.map((d) => (
                <span key={d} className="px-2 py-1 bg-gray-100 rounded text-xs flex items-center gap-1">
                  {d}
                  <button className="text-red-600" onClick={() => setTasks(tasks.map(t => t.id===selected.id ? {...t, deps: t.deps.filter(x=>x!==d)} : t))}>×</button>
                </span>
              ))}
            </div>
            <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={() => deleteTask(selected.id)}>タスク削除</button>
          </div>
        ) : (
          <div className="text-sm text-gray-500">タスクを選択すると編集できます。</div>
        )}

        <div className="mt-auto text-xs text-gray-400">
          保存: 自動（localStorage） / 共有: 共有リンク
        </div>
      </aside>

      <div className="flex-1 relative overflow-auto" onClick={() => setSelectedId(null)}>
        <div className="sticky top-0 z-10 bg-white border-b" style={{ height: HEADER_HEIGHT }}>
          <div className="relative" style={{ width: totalDays * dayWidth, height: HEADER_HEIGHT }}>
            <div className="absolute inset-0">
              {daysArr.map((d, i) => {
                const isFirst = d.getDate() === 1 || i === 0;
                return (
                  <div key={i} className={`absolute top-0 h-full ${isFirst ? "bg-gray-50" : ""}`}
                    style={{ left: i * dayWidth, width: dayWidth, borderLeft: "1px solid #e5e7eb" }}
                    title={fmt(d)}>
                    <div className="text-[10px] text-center text-gray-500">{d.getMonth()+1}/{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="relative" style={{ width: totalDays * dayWidth, height: tasks.length * ROW_HEIGHT + HEADER_HEIGHT }}>
          <div className="absolute inset-0">
            {daysArr.map((d, i) => (
              <div key={i} className="absolute top-0 bottom-0"
                style={{ left: i * dayWidth, width: 1, background: i % 7 === 0 ? "#e2e8f0" : "#f1f5f9" }}/>
            ))}
          </div>

          <DependencyArrows />
          {tasks.map((t, i) => (<TaskRow key={t.id} t={t} index={i} />))}
        </div>
      </div>
    </div>
  );
}
