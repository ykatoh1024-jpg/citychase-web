import { useEffect, useMemo, useRef, useState } from "react";

type Phase = "SETUP" | "POLICE" | "END";
type Cell = { r: number; c: number }; // 0..4
type Node = { r: number; c: number }; // 0..3 (16 intersections)

const GRID = 5;
const NODE = 4;
const MAX_TURN = 11;
const ACTIONS_PER_TURN = 3;

function keyCell(c: Cell) {
  return `${c.r},${c.c}`;
}
function keyNode(n: Node) {
  return `${n.r},${n.c}`;
}

function surroundingCells(node: Node): Cell[] {
  const { r, c } = node;
  return [
    { r, c },
    { r, c: c + 1 },
    { r: r + 1, c },
    { r: r + 1, c: c + 1 },
  ];
}

// 痕跡色（意味：犯人がそのビルにいたターン）
function traceColor(visitTurn: number) {
  if (visitTurn === 1) return "gold";
  if (visitTurn === 6) return "orange";
  return "gray";
}

function inBoundsNode(n: Node) {
  return n.r >= 0 && n.r < NODE && n.c >= 0 && n.c < NODE;
}
function neighborsNode(n: Node): Node[] {
  const cand = [
    { r: n.r - 1, c: n.c },
    { r: n.r + 1, c: n.c },
    { r: n.r, c: n.c - 1 },
    { r: n.r, c: n.c + 1 },
  ];
  return cand.filter(inBoundsNode);
}

function inBoundsCell(c: Cell) {
  return c.r >= 0 && c.r < GRID && c.c >= 0 && c.c < GRID;
}
function neighborsCell(c: Cell): Cell[] {
  const cand = [
    { r: c.r - 1, c: c.c },
    { r: c.r + 1, c: c.c },
    { r: c.r, c: c.c - 1 },
    { r: c.r, c: c.c + 1 },
  ];
  return cand.filter(inBoundsCell);
}

type PoliceMode = "IDLE" | "SEARCH_SELECT";

type GameState = {
  turn: number; // 1..11
  phase: Phase;

  helicopters: Node[]; // 3
  selectedHeli: number | null;

  actionsLeft: number;
  heliActed: boolean[]; // length 3
  mode: PoliceMode;

  criminalPos: Cell; // secret
  visits: Record<string, number[]>;
  revealed: Record<string, boolean>;

  // NEW: 犯人のルート（訪れた順）
  criminalPath: Cell[];

  // UX: 犯人移動中
  criminalMoving: boolean;
  moveWaitSec: 5 | 10 | 15;
  moveEndsAt: number; // epoch ms（表示はしない）
};

function randomCell(): Cell {
  return { r: Math.floor(Math.random() * GRID), c: Math.floor(Math.random() * GRID) };
}
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getHeliColor(index: number) {
  // 0: green, 1: red, 2: yellow
  if (index === 0) return "#22c55e";
  if (index === 1) return "#ef4444";
  return "#facc15";
}

/**
 * 犯人の移動ルール：
 * - 1ターンに1回だけ移動（ターン切替時に1回だけ呼ぶ）
 * - 隣接（縦横）のビルのみ
 * - 再訪不可（1回通った場所を2回通れない）
 */
function criminalNextMove(current: Cell, visits: Record<string, number[]>) {
  const visited = new Set(Object.keys(visits));
  const candidates = neighborsCell(current).filter((n) => !visited.has(keyCell(n)));
  if (candidates.length === 0) return { next: current, moved: false, stuck: true as const };
  return { next: pickRandom(candidates), moved: true, stuck: false as const };
}

// 盤面内の「ビル中心座標」を 0..100% で返す
function cellCenterPct(c: Cell) {
  const x = ((c.c + 0.5) / GRID) * 100;
  const y = ((c.r + 0.5) / GRID) * 100;
  return { x, y };
}

export default function App() {
  const moveTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<GameState>(() => ({
    turn: 1,
    phase: "SETUP",
    helicopters: [],
    selectedHeli: null,
    actionsLeft: ACTIONS_PER_TURN,
    heliActed: [false, false, false],
    mode: "IDLE",
    criminalPos: randomCell(),
    visits: {},
    revealed: {},
    criminalPath: [],
    criminalMoving: false,
    moveWaitSec: 5,
    moveEndsAt: 0,
  }));

  const allNodes = useMemo(() => {
    const a: Node[] = [];
    for (let r = 0; r < NODE; r++) for (let c = 0; c < NODE; c++) a.push({ r, c });
    return a;
  }, []);

  const allCells = useMemo(() => {
    const a: Cell[] = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) a.push({ r, c });
    return a;
  }, []);

  function clearTimers() {
    if (moveTimerRef.current != null) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    clearTimers();
    setState({
      turn: 1,
      phase: "SETUP",
      helicopters: [],
      selectedHeli: null,
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
      mode: "IDLE",
      criminalPos: randomCell(),
      visits: {},
      revealed: {},
      criminalPath: [],
      criminalMoving: false,
      moveWaitSec: 5,
      moveEndsAt: 0,
    });
  }

  // ---- SETUP ----
  function toggleHeli(n: Node) {
    if (state.phase !== "SETUP") return;
    if (state.criminalMoving) return;

    const k = keyNode(n);
    const idx = state.helicopters.findIndex((h) => keyNode(h) === k);

    if (idx >= 0) {
      const next = state.helicopters.slice();
      next.splice(idx, 1);
      setState((s) => ({ ...s, helicopters: next }));
      return;
    }

    if (state.helicopters.length >= 3) return;

    const next = [...state.helicopters, n];
    setState((s) => ({ ...s, helicopters: next }));
  }

  function startGame() {
    if (state.phase !== "SETUP") return;
    if (state.helicopters.length !== 3) return;

    // 犯人初期位置（MVP：ランダム）
    const c0 = randomCell();
    const visits = { ...state.visits };
    visits[keyCell(c0)] = Array.from(new Set([...(visits[keyCell(c0)] ?? []), 1]));

    setState((s) => ({
      ...s,
      phase: "POLICE",
      turn: 1,
      selectedHeli: 0,
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
      mode: "IDLE",
      criminalPos: c0,
      visits,
      criminalPath: [c0], // NEW
    }));
  }

  // ---- POLICE ----
  function isLocked(): boolean {
    return state.criminalMoving || state.phase === "END";
  }

  function selectHeli(i: number) {
    if (state.phase !== "POLICE") return;
    if (isLocked()) return;
    setState((s) => ({ ...s, selectedHeli: i, mode: "IDLE" }));
  }

  function currentHeliCanAct(): boolean {
    if (state.phase !== "POLICE") return false;
    if (state.selectedHeli == null) return false;
    if (state.actionsLeft <= 0) return false;
    if (state.criminalMoving) return false;
    return !state.heliActed[state.selectedHeli];
  }

  function moveHeli(to: Node) {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    if (state.actionsLeft <= 0) return;
    if (state.heliActed[state.selectedHeli]) return;
    if (state.criminalMoving) return;

    const from = state.helicopters[state.selectedHeli];
    const ok = neighborsNode(from).some((n) => keyNode(n) === keyNode(to));
    if (!ok) return;

    const helicopters = state.helicopters.slice();
    helicopters[state.selectedHeli] = to;

    const heliActed = state.heliActed.slice();
    heliActed[state.selectedHeli] = true;

    setState((s) => ({
      ...s,
      helicopters,
      heliActed,
      actionsLeft: s.actionsLeft - 1,
      mode: "IDLE",
    }));
  }

  function enterSearchMode() {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    if (state.actionsLeft <= 0) return;
    if (state.heliActed[state.selectedHeli]) return;
    if (state.criminalMoving) return;
    setState((s) => ({ ...s, mode: "SEARCH_SELECT" }));
  }
  function cancelSearchMode() {
    if (state.phase !== "POLICE") return;
    if (state.criminalMoving) return;
    setState((s) => ({ ...s, mode: "IDLE" }));
  }

  function searchCell(target: Cell) {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    if (state.actionsLeft <= 0) return;
    if (state.mode !== "SEARCH_SELECT") return;
    if (state.heliActed[state.selectedHeli]) return;
    if (state.criminalMoving) return;

    const node = state.helicopters[state.selectedHeli];
    const candidates = surroundingCells(node);
    const isCandidate = candidates.some((c) => c.r === target.r && c.c === target.c);
    if (!isCandidate) return;

    // 逮捕（終了）
    const arrested = target.r === state.criminalPos.r && target.c === state.criminalPos.c;
    if (arrested) {
      setState((s) => ({
        ...s,
        phase: "END",
        mode: "IDLE",
      }));
      return;
    }

    // 痕跡開示（色だけ）
    const k = keyCell(target);
    const revealed = { ...state.revealed };
    const v = state.visits[k];
    if (v && v.length > 0 && !revealed[k]) {
      revealed[k] = true;
    }

    const heliActed = state.heliActed.slice();
    heliActed[state.selectedHeli] = true;

    setState((s) => ({
      ...s,
      revealed,
      heliActed,
      actionsLeft: s.actionsLeft - 1,
      mode: "IDLE",
    }));
  }

  function scheduleCriminalMove(nextTurn: number) {
    clearTimers();

    const wait: 5 | 10 | 15 = pickRandom([5, 10, 15] as const);
    const endsAt = Date.now() + wait * 1000;

    setState((s) => ({
      ...s,
      criminalMoving: true,
      moveWaitSec: wait,
      moveEndsAt: endsAt,
      mode: "IDLE",
    }));

    moveTimerRef.current = window.setTimeout(() => {
      clearTimers();
      setState((prev) => {
        // 途中でリセット等されたら無視
        if (prev.phase !== "POLICE" || prev.turn !== nextTurn - 1) {
          return { ...prev, criminalMoving: false };
        }

        // 隣接・再訪不可の移動
        const mv = criminalNextMove(prev.criminalPos, prev.visits);

        // 行き止まり → 警察勝利扱い（ゲーム終了）
        if (mv.stuck) {
          return {
            ...prev,
            phase: "END",
            criminalMoving: false,
          };
        }

        const visits = { ...prev.visits };
        const kNext = keyCell(mv.next);
        visits[kNext] = Array.from(new Set([...(visits[kNext] ?? []), nextTurn]));

        return {
          ...prev,
          turn: nextTurn,
          criminalPos: mv.next,
          visits,
          criminalPath: [...prev.criminalPath, mv.next], // NEW: ルート追記
          actionsLeft: ACTIONS_PER_TURN,
          heliActed: [false, false, false],
          mode: "IDLE",
          criminalMoving: false,
        };
      });
    }, wait * 1000);
  }

  function endPoliceTurn() {
    if (state.phase !== "POLICE") return;
    if (state.criminalMoving) return;

    // 11ターン逃げ切りで終了（犯人勝ち）
    if (state.turn >= MAX_TURN) {
      setState((s) => ({ ...s, phase: "END", mode: "IDLE" }));
      return;
    }

    const nextTurn = state.turn + 1;
    scheduleCriminalMove(nextTurn);
  }

  // 行動が0になったら自動でターン終了
  useEffect(() => {
    if (state.phase !== "POLICE") return;
    if (state.actionsLeft !== 0) return;
    if (state.criminalMoving) return;
    const t = window.setTimeout(() => endPoliceTurn(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.actionsLeft, state.criminalMoving]);

  // ---- UI helpers ----
  function cellStyle(c: Cell): React.CSSProperties {
    const k = keyCell(c);
    const isRevealed = !!state.revealed[k];
    const turns = state.visits[k] ?? [];
    const first = turns.length ? Math.min(...turns) : null;

    const baseBlue = "#1d4ed8";

    const base: React.CSSProperties = {
      border: "1px solid rgba(255,255,255,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      userSelect: "none",
      background: baseBlue,
    };

    // 捜索選択中：候補4つだけ明るく
    if (state.phase === "POLICE" && state.mode === "SEARCH_SELECT" && state.selectedHeli != null) {
      const node = state.helicopters[state.selectedHeli];
      const cand = surroundingCells(node);
      const isCand = cand.some((x) => x.r === c.r && x.c === c.c);
      if (isCand) {
        base.outline = "3px solid rgba(255,255,255,0.9)";
        base.background = "#2563eb";
        base.cursor = "pointer";
      } else {
        base.opacity = 0.55;
      }
    }

    // 痕跡は色だけ
    if (isRevealed && first != null) {
      base.background = traceColor(first);
      base.opacity = 1;
      base.outline = "2px solid rgba(0,0,0,0.12)";
    }

    // 終了時：犯人の最終位置を赤車で強調
    if (state.phase === "END" && state.criminalPos.r === c.r && state.criminalPos.c === c.c) {
      base.background = "#991b1b";
      base.outline = "3px solid rgba(255,255,255,0.9)";
    }

    return base;
  }

  const canStart = state.phase === "SETUP" && state.helicopters.length === 3;

  // END時だけ「ルート線」を表示
  const routePoints = useMemo(() => {
    if (state.phase !== "END") return [];
    if (!state.criminalPath || state.criminalPath.length < 2) return [];
    return state.criminalPath.map(cellCenterPct);
  }, [state.phase, state.criminalPath]);

  const polylinePoints = useMemo(() => {
    if (routePoints.length === 0) return "";
    return routePoints.map((p) => `${p.x},${p.y}`).join(" ");
  }, [routePoints]);

  return (
    <div style={{ padding: 12, maxWidth: 560, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      {/* Big status */}
      <header
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 12,
          background: "#fff",
          boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 26, fontWeight: 900 }}>
            Turn <span style={{ fontSize: 34 }}>{state.turn}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#666" }}> / {MAX_TURN}</span>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>
              {state.phase === "SETUP" ? "SETUP" : state.phase === "POLICE" ? "POLICE" : "END"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#111" }}>
              行動残り：{state.phase === "POLICE" ? state.actionsLeft : "-"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={reset} style={{ height: 38, flex: 1 }}>
            リセット
          </button>
        </div>
      </header>

      <main style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {/* Board */}
        <section>
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 480,
              margin: "0 auto",
              aspectRatio: "1 / 1",
            }}
          >
            {/* Buildings 5x5 */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                gridTemplateColumns: `repeat(${GRID}, 1fr)`,
                gridTemplateRows: `repeat(${GRID}, 1fr)`,
                gap: 0,
                border: "2px solid #0f172a",
                borderRadius: 16,
                overflow: "hidden",
                background: "#0b1020",
              }}
            >
              {allCells.map((c) => {
                const k = keyCell(c);
                const onClick = () => {
                  if (state.phase === "POLICE" && state.mode === "SEARCH_SELECT") searchCell(c);
                };

                const showCriminal = state.phase === "END" && state.criminalPos.r === c.r && state.criminalPos.c === c.c;

                return (
                  <div key={k} style={cellStyle(c)} onClick={onClick}>
                    {showCriminal ? <span style={{ fontSize: 22 }}>🚗</span> : null}
                  </div>
                );
              })}
            </div>

            {/* END時：犯人ルートのオーバーレイ */}
            {state.phase === "END" && routePoints.length > 0 && (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  pointerEvents: "none",
                }}
              >
                {/* ルート線 */}
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="rgba(255,255,255,0.90)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* ルートの点 */}
                {routePoints.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === 0 || i === routePoints.length - 1 ? 2.2 : 1.6}
                    fill={i === 0 ? "rgba(34,197,94,0.95)" : i === routePoints.length - 1 ? "rgba(239,68,68,0.95)" : "rgba(255,255,255,0.85)"}
                    stroke="rgba(0,0,0,0.25)"
                    strokeWidth="0.4"
                  />
                ))}
                {/* Start/End ラベル */}
                {routePoints.length >= 1 && (
                  <>
                    <text
                      x={routePoints[0].x + 1.6}
                      y={routePoints[0].y - 1.6}
                      fontSize="3.6"
                      fill="rgba(34,197,94,0.95)"
                      fontWeight="700"
                    >
                      S
                    </text>
                    <text
                      x={routePoints[routePoints.length - 1].x + 1.6}
                      y={routePoints[routePoints.length - 1].y - 1.6}
                      fontSize="3.6"
                      fill="rgba(239,68,68,0.95)"
                      fontWeight="700"
                    >
                      E
                    </text>
                  </>
                )}
              </svg>
            )}

            {/* Nodes / Helicopters overlay */}
            {allNodes.map((n) => {
              const k = keyNode(n);
              const placedIndex = state.helicopters.findIndex((h) => keyNode(h) === k);
              const placed = placedIndex >= 0;
              const isSelected = state.selectedHeli != null && placedIndex === state.selectedHeli;
              const acted = placedIndex >= 0 ? state.heliActed[placedIndex] : false;

              const leftPct = ((n.c + 1) / GRID) * 100;
              const topPct = ((n.r + 1) / GRID) * 100;

              const onClick = () => {
                if (state.phase === "SETUP") return toggleHeli(n);
                if (state.phase !== "POLICE") return;
                if (isLocked()) return;

                if (placedIndex >= 0) return selectHeli(placedIndex);
                moveHeli(n);
              };

              // 移動候補表示（選択中ヘリが未行動＆行動残りあり）
              let isMoveCandidate = false;
              if (
                state.phase === "POLICE" &&
                state.selectedHeli != null &&
                state.actionsLeft > 0 &&
                !state.heliActed[state.selectedHeli] &&
                !state.criminalMoving
              ) {
                const from = state.helicopters[state.selectedHeli];
                isMoveCandidate = neighborsNode(from).some((x) => keyNode(x) === k);
              }

              const heliColor = placed ? getHeliColor(placedIndex) : "rgba(255,255,255,0.85)";

              return (
                <button
                  key={k}
                  onClick={onClick}
                  disabled={state.criminalMoving}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    transform: "translate(-50%, -50%)",
                    width: 44,
                    height: 44,
                    borderRadius: 999,
                    border: placed
                      ? `3px solid ${isSelected ? "#0ea5e9" : "#111827"}`
                      : isMoveCandidate
                      ? "3px solid #0ea5e9"
                      : "2px solid rgba(17,24,39,0.45)",
                    background: heliColor,
                    boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
                    fontSize: 18,
                    fontWeight: 900,
                    outline: isSelected ? "3px solid rgba(14,165,233,0.55)" : "none",
                    cursor: state.criminalMoving ? "not-allowed" : "pointer",
                    opacity: placed && acted ? 0.55 : 1,
                    color: placedIndex === 2 ? "#111" : "#fff",
                  }}
                  title={
                    state.phase === "SETUP"
                      ? "ヘリを配置/解除"
                      : placed
                      ? acted
                        ? "このターンは行動済み"
                        : "ヘリを選択"
                      : "移動先（隣接のみ）"
                  }
                >
                  {placed ? "🚁" : "·"}
                </button>
              );
            })}

            {/* Criminal moving overlay（秒数表示なし） */}
            {state.criminalMoving && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  background: "rgba(0,0,0,0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    background: "#111827",
                    color: "#fff",
                    borderRadius: 14,
                    padding: "14px 16px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    width: "min(360px, 92%)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 900 }}>犯人が移動中…</div>
                  <div style={{ fontSize: 26, marginTop: 10 }}>🚗💨</div>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {state.phase === "SETUP" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    helicopters: [],
                    selectedHeli: null,
                  }))
                }
                style={{ flex: 1, height: 44 }}
              >
                配置をやり直す
              </button>
              <button disabled={!canStart} onClick={startGame} style={{ flex: 1, height: 44, fontWeight: 900 }}>
                この配置で開始
              </button>
            </div>
          )}

          {state.phase === "POLICE" && (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#555" }}>
                1ターン3行動（移動 or 捜索）。各ヘリは1ターンに1回まで。捜索は周囲4ビルから1つ選択。
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={!currentHeliCanAct()}
                  onClick={enterSearchMode}
                  style={{ flex: 1, height: 48, fontWeight: 900 }}
                >
                  捜索する（1行動）
                </button>

                <button disabled={state.mode !== "SEARCH_SELECT"} onClick={cancelSearchMode} style={{ width: 120, height: 48 }}>
                  捜索取消
                </button>
              </div>

              <button onClick={endPoliceTurn} disabled={state.criminalMoving} style={{ height: 44 }}>
                ターン終了（残り行動を捨てる）
              </button>
            </div>
          )}

          {state.phase === "END" && (
            <div style={{ marginTop: 12, textAlign: "center", color: "#444", fontSize: 13 }}>
              終了：犯人ルート（白線） / 開始=S（緑） / 終了=E（赤）
            </div>
          )}
        </section>
      </main>

      <footer style={{ marginTop: 12, fontSize: 12, color: "#666" }}>※犯人ルートはゲーム終了時のみ表示します。</footer>
    </div>
  );
}
