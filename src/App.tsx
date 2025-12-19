import { useMemo, useState } from "react";

type Phase = "SETUP" | "POLICE" | "END";
type Cell = { r: number; c: number }; // 0..4
type Node = { r: number; c: number }; // 0..3 (16 intersections)

const GRID = 5; // 5x5 buildings
const NODE = 4; // 4x4 intersections
const MAX_TURN = 11;
const ACTIONS_PER_TURN = 3;

function keyCell(c: Cell) {
  return `${c.r},${c.c}`;
}
function keyNode(n: Node) {
  return `${n.r},${n.c}`;
}

// Each node surrounds exactly 4 buildings:
function surroundingCells(node: Node): Cell[] {
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

type PoliceMode = "IDLE" | "SEARCH_SELECT";

type GameState = {
  turn: number; // 1..11
  phase: Phase;

  // Setup / police
  helicopters: Node[]; // 3
  selectedHeli: number | null;

  // Police turn
  actionsLeft: number; // 3 -> 0
  mode: PoliceMode;

  // Criminal (secret)
  criminalPos: Cell;

  // Criminal visit history: cell -> [turns visited]
  visits: Record<string, number[]>;

  // Trace revealed: cell -> boolean
  revealed: Record<string, boolean>;

  log: string[];
};

function randomCell(): Cell {
  return { r: Math.floor(Math.random() * GRID), c: Math.floor(Math.random() * GRID) };
}

// MVP criminal: random move each turn (later improve)
function criminalNextCell(): Cell {
  return randomCell();
}

export default function App() {
  const [state, setState] = useState<GameState>(() => ({
    turn: 1,
    phase: "SETUP",
    helicopters: [],
    selectedHeli: null,
    actionsLeft: ACTIONS_PER_TURN,
    mode: "IDLE",
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
      actionsLeft: ACTIONS_PER_TURN,
      mode: "IDLE",
      criminalPos: randomCell(),
      visits: {},
      revealed: {},
      log: ["ヘリを3機配置してください（交差点をタップ）"],
    });
  }

  // --- Setup: place/unplace helicopters on nodes ---
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
      selectedHeli: 0, // default select first helicopter
      actionsLeft: ACTIONS_PER_TURN,
      mode: "IDLE",
      criminalPos: c0,
      visits,
      log: ["犯人が隠れた…（警察ターン開始）", ...s.log],
    }));
  }

  // --- Police: select helicopter (does NOT consume action) ---
  function selectHeli(i: number) {
    if (state.phase !== "POLICE") return;
    setState((s) => ({ ...s, selectedHeli: i, mode: "IDLE" }));
  }

  // --- Police action: move selected heli to neighbor (consumes 1 action) ---
  function moveHeli(to: Node) {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    if (state.actionsLeft <= 0) return;

    const from = state.helicopters[state.selectedHeli];
    const ok = neighbors(from).some((n) => keyNode(n) === keyNode(to));
    if (!ok) return;

    const next = state.helicopters.slice();
    next[state.selectedHeli] = to;

    setState((s) => ({
      ...s,
      helicopters: next,
      actionsLeft: s.actionsLeft - 1,
      mode: "IDLE",
      log: [`T${s.turn}：移動（残り行動 ${s.actionsLeft - 1}）`, ...s.log],
    }));
  }

  // --- Police action: start search selection (does NOT consume action yet) ---
  function enterSearchMode() {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    if (state.actionsLeft <= 0) return;
    setState((s) => ({ ...s, mode: "SEARCH_SELECT" }));
  }

  function cancelSearchMode() {
    if (state.phase !== "POLICE") return;
    setState((s) => ({ ...s, mode: "IDLE" }));
  }

  // --- Police action: choose 1 building among 4 to search (consumes 1 action) ---
  function searchCell(target: Cell) {
    if (state.phase !== "POLICE") return;
    if (state.selectedHeli == null) return;
    if (state.actionsLeft <= 0) return;
    if (state.mode !== "SEARCH_SELECT") return;

    const node = state.helicopters[state.selectedHeli];
    const candidates = surroundingCells(node);
    const isCandidate = candidates.some((c) => c.r === target.r && c.c === target.c);
    if (!isCandidate) return;

    // Arrest check: only the selected building counts
    const arrested = target.r === state.criminalPos.r && target.c === state.criminalPos.c;
    if (arrested) {
      setState((s) => ({
        ...s,
        phase: "END",
        mode: "IDLE",
        log: [`T${s.turn}：捜索 → 逮捕！警察の勝ち`, ...s.log],
      }));
      return;
    }

    // Reveal trace if criminal visited this building before
    const k = keyCell(target);
    const revealed = { ...state.revealed };
    let foundTrace = false;

    const v = state.visits[k];
    if (v && v.length > 0 && !revealed[k]) {
      revealed[k] = true;
      foundTrace = true;
    }

    setState((s) => ({
      ...s,
      revealed,
      actionsLeft: s.actionsLeft - 1,
      mode: "IDLE",
      log: [
        `T${s.turn}：捜索（${foundTrace ? "痕跡あり" : "痕跡なし"}・残り行動 ${s.actionsLeft - 1}）`,
        ...s.log,
      ],
    }));
  }

  // --- End police turn (auto when actionsLeft==0, or manually) ---
  function endPoliceTurn() {
    if (state.phase !== "POLICE") return;

    // If already at last turn, criminal wins after police finishes?
    // Standard: if police finishes turn 11 without arrest -> criminal wins.
    if (state.turn >= MAX_TURN) {
      setState((s) => ({
        ...s,
        phase: "END",
        mode: "IDLE",
        log: ["11ターン逃げ切り：犯人の勝ち", ...s.log],
      }));
      return;
    }

    // Criminal moves at start of next turn number (turn+1)
    const nextTurn = state.turn + 1;
    const cNext = criminalNextCell();
    const visits = { ...state.visits };
    const kNext = keyCell(cNext);
    visits[kNext] = Array.from(new Set([...(visits[kNext] ?? []), nextTurn]));

    setState((s) => ({
      ...s,
      turn: nextTurn,
      criminalPos: cNext,
      visits,
      actionsLeft: ACTIONS_PER_TURN,
      mode: "IDLE",
      log: [`T${nextTurn}：犯人が移動した…`, `T${nextTurn}：警察ターン開始（行動3）`, ...s.log],
    }));
  }

  // auto-advance when actionsLeft hits 0 (and not in END)
  if (state.phase === "POLICE" && state.actionsLeft === 0) {
    // schedule end of turn on next tick to avoid setState during render loop
    setTimeout(() => {
      // guard: still same state
      setState((prev) => {
        if (prev.phase !== "POLICE" || prev.actionsLeft !== 0) return prev;
        // end turn
        const prevState = prev;
        if (prevState.turn >= MAX_TURN) {
          return {
            ...prevState,
            phase: "END",
            mode: "IDLE",
            log: ["11ターン逃げ切り：犯人の勝ち", ...prevState.log],
          };
        }

        const nextTurn = prevState.turn + 1;
        const cNext = criminalNextCell();
        const visits = { ...prevState.visits };
        const kNext = keyCell(cNext);
        visits[kNext] = Array.from(new Set([...(visits[kNext] ?? []), nextTurn]));

        return {
          ...prevState,
          turn: nextTurn,
          criminalPos: cNext,
          visits,
          actionsLeft: ACTIONS_PER_TURN,
          mode: "IDLE",
          log: [`T${nextTurn}：犯人が移動した…`, `T${nextTurn}：警察ターン開始（行動3）`, ...prevState.log],
        };
      });
    }, 0);
  }

  // --- UI helpers ---
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
      userSelect: "none",
      background: "#f7f7f7",
    };

    // If in search selection mode, highlight only candidates
    if (state.phase === "POLICE" && state.mode === "SEARCH_SELECT" && state.selectedHeli != null) {
      const node = state.helicopters[state.selectedHeli];
      const cand = surroundingCells(node);
      const isCand = cand.some((x) => x.r === c.r && x.c === c.c);
      if (isCand) {
        base.outline = "2px solid dodgerblue";
        base.background = "#ffffff";
        base.cursor = "pointer";
      } else {
        base.opacity = 0.5;
      }
    }

    if (isRevealed && first != null) {
      base.background = traceColor(first);
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
            Turn: {state.turn}/{MAX_TURN} ・ Phase: {state.phase}
            {state.phase === "POLICE" ? ` ・ 行動残り: ${state.actionsLeft}` : ""}
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
            盤面（ビル5×5）＋ヘリ（交差点4×4）
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
                const onClick = () => {
                  if (state.phase === "POLICE" && state.mode === "SEARCH_SELECT") {
                    searchCell(c);
                  }
                };

                return (
                  <div key={k} style={cellStyle(c)} onClick={onClick}>
                    {/* 痕跡ターン番号は表示しない（色だけ） */}
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

                // selecting a helicopter does not consume action
                if (placedIndex >= 0) return selectHeli(placedIndex);

                // move consumes 1 action (only if neighbor)
                moveHeli(n);
              };

              // movement hint: highlight neighbor nodes when a heli is selected & actions left
              let isMoveCandidate = false;
              if (state.phase === "POLICE" && state.selectedHeli != null && state.actionsLeft > 0) {
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
                    border:
                      placed
                        ? "2px solid #000"
                        : isMoveCandidate
                        ? "2px solid dodgerblue"
                        : "1px solid #aaa",
                    background: placed ? "#f2f2f2" : "rgba(255,255,255,0.92)",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                    fontSize: 16,
                    fontWeight: 900,
                    outline: isSelected ? "3px solid dodgerblue" : "none",
                    cursor: "pointer",
                  }}
                  aria-label={`node-${n.r}-${n.c}`}
                  title={
                    state.phase === "SETUP"
                      ? "ヘリを配置/解除"
                      : placed
                      ? "ヘリを選択"
                      : "移動先（隣接のみ）"
                  }
                >
                  {placed ? `🚁${placedIndex + 1}` : "・"}
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
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                ルール：1ターンに行動3回（移動 or 捜索）。捜索は周囲4ビルから1つ選択。
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={state.selectedHeli == null || state.actionsLeft <= 0}
                  onClick={enterSearchMode}
                  style={{ flex: 1, height: 44, fontWeight: 900 }}
                >
                  捜索する（1行動）
                </button>

                <button
                  disabled={state.mode !== "SEARCH_SELECT"}
                  onClick={cancelSearchMode}
                  style={{ width: 120, height: 44 }}
                >
                  捜索取消
                </button>
              </div>

              <button
                onClick={endPoliceTurn}
                disabled={state.phase !== "POLICE"}
                style={{ height: 40 }}
              >
                ターン終了（残り行動を捨てる）
              </button>

              <div style={{ marginTop: 2, fontSize: 12, color: "#666" }}>
                操作：🚁をタップで選択（行動消費なし）→ 隣接交差点をタップで移動（1行動）。
                「捜索する」を押すと青枠の4ビルが選べます（1行動）。
              </div>
            </div>
          )}
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
        ※犯人AIは現状ランダム（MVP）。次は「ヘリから離れる」重み付けにすると推理が気持ちよくなります。
      </footer>
    </div>
  );
}
