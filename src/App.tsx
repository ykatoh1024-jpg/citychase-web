import { useMemo, useState } from "react";

type Phase = "SETUP" | "CRIMINAL" | "POLICE" | "END";
type Cell = { r: number; c: number }; // 0..4
type Node = { r: number; c: number }; // 0..3 (16 nodes / intersections)

const GRID = 5; // 5x5 buildings
const NODE = 4; // 4x4 intersections

function keyCell(c: Cell) {
  return `${c.r},${c.c}`;
}
function keyNode(n: Node) {
  return `${n.r},${n.c}`;
}

function searchedCells(node: Node): Cell[] {
  const { r, c } = node;
  return [
    { r, c },
    { r, c: c + 1 },
    { r: r + 1, c },
    { r: r + 1, c: c + 1 },
  ];
}

// visitTurn -> color (meaning: the turn when criminal was there)
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
  turn: number; // 1..11
  phase: Phase;

  helicopters: Node[]; // 3
  selectedHeli: number | null;

  criminalPos: Cell; // secret

  visits: Record<string, number[]>; // cell -> [turns visited]
  revealed: Record<string, boolean>; // cell -> revealed trace?

  log: string[];
};

function randomCell(): Cell {
  return {
    r: Math.floor(Math.random() * GRID),
    c: Math.floor(Math.random() * GRID),
  };
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
    log: ["ヘリを3機配置してください（交差点をタップ）"],
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
      log: ["ヘリを3機配置してください（交差点をタップ）"],
    });
  }

  // Setup: place/unplace helicopters on nodes
  function toggleHeli(n: Node) {
    if (state.phase !== "SETUP") return;

    const k = keyNode(n);
    const idx = state.helicopters.findIndex((h) => keyNode(h) === k);

    if (idx >= 0) {
      const next = state.helicopters.slice();
      next.splice(idx, 1);
      setState((s) => ({
        ...s,
        helicopters: next,
        log: [`ヘリを外しました（残り ${3 - next.length}）`, ...s.log],
      }));
      return;
    }

    if (state.helicopters.length >= 3) return;

    const next = [...state.helicopters, n];
    setState((s) => ({
      ...s,
      helicopters: next,
      log: [`ヘリを配置しました（残り ${3 - next.length}）`, ...s.log],
    }));
  }

  function startGame() {
    if (state.phase !== "SETUP") return;
    if (state.helicopters.length !== 3) return;

    // Criminal chooses initial position after seeing helicopters (MVP: random)
    const c0 = randomCell();
    const visits = { ...state.visits };
    visits[keyCell(c0)] = Array.from(new Set([...(visits[keyCell(c0)] ?? []), 1]));

    setState((s) => ({
      ...s,
      phase: "POLICE",
      turn: 1,
      selectedHeli: null,
      criminalPos: c0,
      visits,
      log: ["犯人が隠れた…", ...s.log],
    }));
  }

  // Police: select heli
  function selectHeli(i: number) {
    if (state.phase !== "POLICE") return;
    setState((s) => ({ ...s, selectedHeli: i }));
  }

  // Police: move selected heli to neighbor
  function moveHeli(to: Node) {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;

    const from = state.helicopters[state.selectedHeli];
    const ok = neighbors(from).some((n) => keyNode(n) === keyNode(to));
    if (!ok) return;

    const next = state.helicopters.slice();
    next[state.selectedHeli] = to;

    setState((s) => ({
      ...s,
      helicopters: next,
      log: [`T${s.turn}：ヘリを移動`, ...s.log],
    }));
  }

  // Police: search using selected heli at its node (surrounding 4 buildings)
  function search() {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;

    const node = state.helicopters[state.selectedHeli];
    const targets = searchedCells(node);

    // arrest check: if criminal current position is among searched 4 buildings
    const arrested = targets.some(
      (c) => c.r === state.criminalPos.r && c.c === state.criminalPos.c
    );
    if (arrested) {
      setState((s) => ({
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

    // advance turn and move criminal (MVP: random)
    const nextTurn = state.turn + 1;

    // log search result on current turn
    const logPrefix = `T${state.turn}：捜索（痕跡${foundAny ? "あり" : "なし"}）`;

    if (nextTurn > 11) {
      setState((s) => ({
        ...s,
        phase: "END",
        revealed,
        log: [logPrefix, "11ターン逃げ切り：犯人の勝ち", ...s.log],
      }));
      return;
    }

    const cNext = randomCell();
    const visits = { ...state.visits };
    const kNext = keyCell(cNext);
    visits[kNext] = Array.from(new Set([...(visits[kNext] ?? []), nextTurn]));

    setState((s) => ({
      ...s,
      turn: nextTurn,
      criminalPos: cNext,
      visits,
      revealed,
      log: [logPrefix, `T${nextTurn}：犯人が移動した…`, ...s.log],
    }));
  }

  function cellStyle(c: Cell): React.CSSProperties {
    const k = keyCell(c);
    const isRevealed = !!state.revealed[k];
    const turns = state.visits[k] ?? [];
    const first = turns.length ? Math.min(...turns) : null;

    const base: React.CSSProperties = {
      border: "1px solid #ddd",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      userSelect: "none",
      background: "#f7f7f7",
    };

    if (isRevealed && first != null) {
      base.background = traceColor(first);
      base.color = first === 1 ? "#000" : "#fff";
      base.fontWeight = 800;
    }

    return base;
  }

  const canStart = state.phase === "SETUP" && state.helicopters.length === 3;

  return (
    <div style={{ padding: 12, maxWidth: 520, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 900 }}>シティチェイスWeb（MVP）</div>
          <div style={{ fontSize: 12, color: "#555" }}>
            Turn: {state.turn}/11 ・ Phase: {state.phase}
          </div>
        </div>
        <button onClick={reset} style={{ height: 36 }}>
          リセット
        </button>
      </header>

      <main style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {/* Board + Helicopters overlay */}
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            盤面（ビル5×5）＋ヘリ（交差点4×4を重ね表示）
          </div>

          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 460,
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
                border: "1px solid #bbb",
                borderRadius: 12,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              {allCells.map((c) => {
                const k = keyCell(c);
                const turns = state.visits[k] ?? [];
                const first = turns.length ? Math.min(...turns) : null;

                return (
                  <div key={k} style={cellStyle(c)}>
                    {state.revealed[k] && first != null ? `痕跡T${first}` : ""}
                  </div>
                );
              })}
            </div>

            {/* Nodes overlay (4x4 intersections) */}
            {allNodes.map((n) => {
              const k = keyNode(n);
              const placedIndex = state.helicopters.findIndex((h) => keyNode(h) === k);
              const placed = placedIndex >= 0;
              const isSelected = state.selectedHeli != null && placedIndex === state.selectedHeli;

              // Intersection position on the board border lines: (1/5,2/5,3/5,4/5)
              const leftPct = ((n.c + 1) / GRID) * 100;
              const topPct = ((n.r + 1) / GRID) * 100;

              const onClick = () => {
                if (state.phase === "SETUP") return toggleHeli(n);
                if (state.phase !== "POLICE") return;

                if (placedIndex >= 0) return selectHeli(placedIndex);
                moveHeli(n);
              };

              // Show movement hint: highlight neighbor nodes when a heli is selected
              let isMoveCandidate = false;
              if (state.phase === "POLICE" && state.selectedHeli != null && !placed) {
                const from = state.helicopters[state.selectedHeli];
                isMoveCandidate = neighbors(from).some((x) => keyNode(x) === k);
              }

              return (
                <button
                  key={k}
                  onClick={onClick}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    transform: "translate(-50%, -50%)",
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    border: placed ? "2px solid #000" : isMoveCandidate ? "2px solid dodgerblue" : "1px solid #aaa",
                    background: placed ? "#f2f2f2" : "rgba(255,255,255,0.92)",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                    fontSize: 16,
                    fontWeight: 900,
                    outline: isSelected ? "3px solid dodgerblue" : "none",
                    cursor: "pointer",
                  }}
                  aria-label={`node-${n.r}-${n.c}`}
                  title={state.phase === "SETUP" ? "ヘリを配置/解除" : placed ? "ヘリを選択" : "移動先"}
                >
                  {placed ? `🚁${placedIndex + 1}` : "＋"}
                </button>
              );
            })}
          </div>

          {/* Controls */}
          {state.phase === "SETUP" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    helicopters: [],
                    selectedHeli: null,
                    log: ["ヘリを3機配置してください（交差点をタップ）", ...s.log],
                  }))
                }
                style={{ flex: 1, height: 40 }}
              >
                配置をやり直す
              </button>
              <button disabled={!canStart} onClick={startGame} style={{ flex: 1, height: 40 }}>
                この配置で開始
              </button>
            </div>
          )}

          {state.phase === "POLICE" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                disabled={state.selectedHeli == null}
                onClick={search}
                style={{ flex: 1, height: 44, fontWeight: 900 }}
              >
                捜索する（周囲4ビル）
              </button>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            操作：SETUPは交差点の「＋」を押してヘリを3つ配置 → 開始。POLICEは🚁を押して選択 → 隣接交差点を押すと移動。
          </div>
        </section>

        {/* Log */}
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>ログ</div>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 10,
              maxHeight: 240,
              overflow: "auto",
              background: "#fff",
            }}
          >
            {state.log.slice(0, 40).map((l, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  padding: "4px 0",
                  borderBottom: "1px dashed #eee",
                }}
              >
                {l}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
        ※MVPの犯人AIは仮（ランダム移動）です。まずUIの臨場感とルール骨格を固めています。
      </footer>
    </div>
  );
}
