import { useMemo, useState } from "react";

type Phase = "SETUP" | "CRIMINAL" | "POLICE" | "END";
type Cell = { r: number; c: number }; // 0..4
type Node = { r: number; c: number }; // 0..3 (16 nodes)

const GRID = 5;      // 5x5 buildings
const NODE = 4;      // 4x4 intersections

function keyCell(c: Cell) { return `${c.r},${c.c}`; }
function keyNode(n: Node) { return `${n.r},${n.c}`; }

function searchedCells(node: Node): Cell[] {
  const { r, c } = node;
  return [
    { r, c },
    { r, c: c + 1 },
    { r: r + 1, c },
    { r: r + 1, c: c + 1 },
  ];
}

// MVP: visitTurn -> color
function traceColor(visitTurn: number) {
  if (visitTurn === 1) return "gold";
  if (visitTurn === 6) return "orange";
  return "gray";
}

function inBoundsNode(n: Node) {
  return n.r >= 0 && n.r < NODE && n.c >= 0 && n.c < NODE;
}
function neighbors(n: Node): Node[] {
  const cand = [
    { r: n.r - 1, c: n.c },
    { r: n.r + 1, c: n.c },
    { r: n.r, c: n.c - 1 },
    { r: n.r, c: n.c + 1 },
  ];
  return cand.filter(inBoundsNode);
}

type GameState = {
  turn: number;           // 1..11
  phase: Phase;

  helicopters: Node[];    // 3
  selectedHeli: number | null;

  criminalPos: Cell;      // secret

  visits: Record<string, number[]>;   // cell -> [turns]
  revealed: Record<string, boolean>;  // cell -> bool

  log: string[];
};

function randomCell(): Cell {
  return { r: Math.floor(Math.random() * GRID), c: Math.floor(Math.random() * GRID) };
}

export default function App() {
  const [state, setState] = useState<GameState>(() => ({
    turn: 1,
    phase: "SETUP",
    helicopters: [],
    selectedHeli: null,
    criminalPos: randomCell(),
    visits: {},
    revealed: {},
    log: ["ヘリを3機配置してください"],
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

  function reset() {
    setState({
      turn: 1,
      phase: "SETUP",
      helicopters: [],
      selectedHeli: null,
      criminalPos: randomCell(),
      visits: {},
      revealed: {},
      log: ["ヘリを3機配置してください"],
    });
  }

  // Setup: place/unplace helicopters on nodes
  function toggleHeli(n: Node) {
    if (state.phase !== "SETUP") return;
    const k = keyNode(n);
    const idx = state.helicopters.findIndex(h => keyNode(h) === k);
    if (idx >= 0) {
      const next = state.helicopters.slice();
      next.splice(idx, 1);
      setState(s => ({
        ...s,
        helicopters: next,
        log: [`ヘリを外しました（残り ${3 - next.length}）`, ...s.log],
      }));
      return;
    }
    if (state.helicopters.length >= 3) return;
    const next = [...state.helicopters, n];
    setState(s => ({
      ...s,
      helicopters: next,
      log: [`ヘリを配置しました（残り ${3 - next.length}）`, ...s.log],
    }));
  }

  function startGame() {
    if (state.phase !== "SETUP") return;
    if (state.helicopters.length !== 3) return;

    // criminal decides initial position after seeing helicopters (MVP: random)
    const c0 = randomCell();
    const visits = { ...state.visits };
    visits[keyCell(c0)] = Array.from(new Set([...(visits[keyCell(c0)] ?? []), 1]));

    setState(s => ({
      ...s,
      phase: "POLICE", // skip animation for now; MVP starts at police turn 1
      criminalPos: c0,
      visits,
      log: ["犯人が隠れた…", ...s.log],
    }));
  }

  // Police: select heli
  function selectHeli(i: number) {
    if (state.phase !== "POLICE") return;
    setState(s => ({ ...s, selectedHeli: i }));
  }

  // Police: move selected heli to neighbor
  function moveHeli(to: Node) {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    const from = state.helicopters[state.selectedHeli];
    const ok = neighbors(from).some(n => keyNode(n) === keyNode(to));
    if (!ok) return;

    const next = state.helicopters.slice();
    next[state.selectedHeli] = to;

    setState(s => ({
      ...s,
      helicopters: next,
      log: [`T${s.turn}：ヘリを移動`, ...s.log],
    }));
  }

  // Police: search using selected heli at its node
  function search() {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    const node = state.helicopters[state.selectedHeli];
    const targets = searchedCells(node);

    // arrest check
    const arrested = targets.some(c => c.r === state.criminalPos.r && c.c === state.criminalPos.c);
    if (arrested) {
      setState(s => ({
        ...s,
        phase: "END",
        log: [`T${s.turn}：逮捕！警察の勝ち`, ...s.log],
      }));
      return;
    }

    // reveal traces if any visited in past and not revealed yet
    const revealed = { ...state.revealed };
    let foundAny = false;
    for (const c of targets) {
      const k = keyCell(c);
      const v = state.visits[k];
      if (v && v.length > 0 && !revealed[k]) {
        revealed[k] = true;
        foundAny = true;
      }
    }

    // advance turn with simple criminal move (MVP: random move)
    const nextTurn = state.turn + 1;
    if (nextTurn > 11) {
      setState(s => ({
        ...s,
        phase: "END",
        revealed,
        log: [`T${s.turn}：捜索（痕跡${foundAny ? "あり" : "なし"}）`, "11ターン逃げ切り：犯人の勝ち", ...s.log],
      }));
      return;
    }

    // criminal "moves" (MVP: random cell)
    const cNext = randomCell();
    const visits = { ...state.visits };
    const kNext = keyCell(cNext);
    visits[kNext] = Array.from(new Set([...(visits[kNext] ?? []), nextTurn]));

    setState(s => ({
      ...s,
      turn: nextTurn,
      criminalPos: cNext,
      visits,
      revealed,
      log: [`T${s.turn}：捜索（痕跡${foundAny ? "あり" : "なし"}）`, `T${nextTurn}：犯人が移動した…`, ...s.log],
    }));
  }

  // UI helpers
  function cellStyle(c: Cell): React.CSSProperties {
    const k = keyCell(c);
    const isRevealed = !!state.revealed[k];
    const turns = state.visits[k] ?? [];
    const first = turns.length ? Math.min(...turns) : null;

    const base: React.CSSProperties = {
      border: "1px solid #ccc",
      borderRadius: 8,
      aspectRatio: "1 / 1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      userSelect: "none",
    };

    if (isRevealed && first != null) {
      base.background = traceColor(first);
      base.color = first === 1 ? "#000" : "#fff";
      base.fontWeight = 700;
    } else {
      base.background = "#f6f6f6";
    }
    return base;
  }

  function nodeButtonStyle(n: Node): React.CSSProperties {
    const placed = state.helicopters.some(h => keyNode(h) === keyNode(n));
    return {
      width: 44,
      height: 44,
      borderRadius: 10,
      border: placed ? "2px solid #000" : "1px solid #bbb",
      background: placed ? "#eaeaea" : "#fff",
      fontWeight: placed ? 700 : 400,
    };
  }

  const canStart = state.phase === "SETUP" && state.helicopters.length === 3;

  return (
    <div style={{ padding: 12, maxWidth: 480, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 800 }}>City Chase Web（MVP）</div>
          <div style={{ fontSize: 12, color: "#555" }}>
            Turn: {state.turn}/11 ・ Phase: {state.phase}
          </div>
        </div>
        <button onClick={reset} style={{ height: 36 }}>リセット</button>
      </header>

      <main style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {/* Board */}
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>ビル（痕跡が見つかったら色が変わる）</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID}, 1fr)`, gap: 6 }}>
            {allCells.map(c => {
              const k = keyCell(c);
              const turns = state.visits[k] ?? [];
              const first = turns.length ? Math.min(...turns) : null;
              return (
                <div key={k} style={cellStyle(c)}>
                  {state.revealed[k] && first != null ? `痕跡T${first}` : "ビル"}
                </div>
              );
            })}
          </div>
        </section>

        {/* Helicopters / Nodes */}
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            ヘリ交点（4×4＝16ヶ所）{state.phase === "SETUP" ? "：タップで配置" : "：タップで選択/移動"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${NODE}, 1fr)`, gap: 8 }}>
            {allNodes.map(n => {
              const k = keyNode(n);
              const placedIndex = state.helicopters.findIndex(h => keyNode(h) === k);
              const isSelected = state.selectedHeli != null && placedIndex === state.selectedHeli;

              const onClick = () => {
                if (state.phase === "SETUP") return toggleHeli(n);
                if (state.phase !== "POLICE") return;
                if (placedIndex >= 0) return selectHeli(placedIndex);
                // move if neighbor of selected heli
                moveHeli(n);
              };

              return (
                <button
                  key={k}
                  onClick={onClick}
                  style={{
                    ...nodeButtonStyle(n),
                    outline: isSelected ? "3px solid dodgerblue" : "none",
                  }}
                >
                  {placedIndex >= 0 ? `🚁${placedIndex + 1}` : "・"}
                </button>
              );
            })}
          </div>

          {state.phase === "SETUP" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => setState(s => ({ ...s, helicopters: [], log: ["ヘリを3機配置してください", ...s.log] }))} style={{ flex: 1, height: 40 }}>
                配置をやり直す
              </button>
              <button disabled={!canStart} onClick={startGame} style={{ flex: 1, height: 40 }}>
                この配置で開始
              </button>
            </div>
          )}

          {state.phase === "POLICE" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button disabled={state.selectedHeli == null} onClick={search} style={{ flex: 1, height: 44, fontWeight: 800 }}>
                捜索する（周囲4ビル）
              </button>
            </div>
          )}
        </section>

        {/* Log */}
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>ログ</div>
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, maxHeight: 220, overflow: "auto", background: "#fff" }}>
            {state.log.slice(0, 30).map((l, i) => (
              <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px dashed #eee" }}>
                {l}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
        操作：SETUPは交点をタップして🚁を3つ配置 → 開始。POLICEは🚁をタップで選択、隣接交点をタップで移動、捜索ボタン。
      </footer>
    </div>
  );
}

