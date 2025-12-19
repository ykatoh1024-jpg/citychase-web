import { useEffect, useMemo, useRef, useState } from "react";

type Role = "POLICE" | "CRIMINAL";
type Phase =
  | "ROLE_SELECT"
  | "POLICE_SETUP"
  | "POLICE_TURN"
  | "CRIMINAL_AI_MOVING"
  | "CRIMINAL_HIDE"
  | "POLICE_AI_TURN"
  | "CRIMINAL_MOVE"
  | "END";

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

function inBoundsCell(c: Cell) {
  return c.r >= 0 && c.r < GRID && c.c >= 0 && c.c < GRID;
}
function neighborsCell(c: Cell): Cell[] {
  return [
    { r: c.r - 1, c: c.c },
    { r: c.r + 1, c: c.c },
    { r: c.r, c: c.c - 1 },
    { r: c.r, c: c.c + 1 },
  ].filter(inBoundsCell);
}

function inBoundsNode(n: Node) {
  return n.r >= 0 && n.r < NODE && n.c >= 0 && n.c < NODE;
}
function neighborsNode(n: Node): Node[] {
  return [
    { r: n.r - 1, c: n.c },
    { r: n.r + 1, c: n.c },
    { r: n.r, c: n.c - 1 },
    { r: n.r, c: n.c + 1 },
  ].filter(inBoundsNode);
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

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomCell(): Cell {
  return { r: Math.floor(Math.random() * GRID), c: Math.floor(Math.random() * GRID) };
}

function getHeliColor(index: number) {
  // 0: green, 1: red, 2: yellow
  if (index === 0) return "#22c55e";
  if (index === 1) return "#ef4444";
  return "#facc15";
}

// 盤面内の「ビル中心座標」を 0..100% で返す（ルート線用）
function cellCenterPct(c: Cell) {
  const x = ((c.c + 0.5) / GRID) * 100;
  const y = ((c.r + 0.5) / GRID) * 100;
  return { x, y };
}

function manhattanCell(a: Cell, b: Cell) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

function uniqueRandomNodes(count: number): Node[] {
  const all: Node[] = [];
  for (let r = 0; r < NODE; r++) for (let c = 0; c < NODE; c++) all.push({ r, c });
  const picked: Node[] = [];
  const used = new Set<string>();
  while (picked.length < count && picked.length < all.length) {
    const n = pickRandom(all);
    const k = keyNode(n);
    if (used.has(k)) continue;
    used.add(k);
    picked.push(n);
  }
  return picked;
}

/**
 * 犯人AI（詰み回避・待機なし）
 * - 毎ターン「残りターン分だけ self-avoiding（再訪なし）で歩ける」手を先読みで保証して選ぶ
 * - 5x5で最大11ターンなら計算量は十分軽い
 */
function criminalAiNextMoveNoStuck(current: Cell, visits: Record<string, number[]>, currentTurn: number) {
  const visited = new Set(Object.keys(visits));
  const remainingMoves = MAX_TURN - currentTurn; // これから何回移動する必要があるか

  const nextCandidates = neighborsCell(current).filter((n) => !visited.has(keyCell(n)));

  if (nextCandidates.length === 0) {
    return { next: current, stuck: true as const };
  }

  function canFinishFrom(pos: Cell, stepsLeft: number, visitedSet: Set<string>): boolean {
    if (stepsLeft <= 0) return true;

    const neigh = neighborsCell(pos).filter((n) => !visitedSet.has(keyCell(n)));
    if (neigh.length === 0) return false;

    // 詰みにくい順（逃げ道が少ない所から試す）
    neigh.sort((a, b) => {
      const da = neighborsCell(a).filter((x) => !visitedSet.has(keyCell(x))).length;
      const db = neighborsCell(b).filter((x) => !visitedSet.has(keyCell(x))).length;
      return da - db;
    });

    for (const n of neigh) {
      const k = keyCell(n);
      visitedSet.add(k);
      if (canFinishFrom(n, stepsLeft - 1, visitedSet)) return true;
      visitedSet.delete(k);
    }
    return false;
  }

  const safeMoves: Cell[] = [];
  for (const cand of nextCandidates) {
    const tmp = new Set(visited);
    tmp.add(keyCell(cand));
    if (canFinishFrom(cand, remainingMoves - 1, tmp)) safeMoves.push(cand);
  }

  const pickFrom = safeMoves.length > 0 ? safeMoves : nextCandidates;

  const center: Cell = { r: 2, c: 2 };
  pickFrom.sort((a, b) => {
    const ea = neighborsCell(a).filter((x) => !visited.has(keyCell(x))).length;
    const eb = neighborsCell(b).filter((x) => !visited.has(keyCell(x))).length;
    const ca = 1 / (1 + manhattanCell(a, center));
    const cb = 1 / (1 + manhattanCell(b, center));
    return eb * 10 + cb - (ea * 10 + ca);
  });

  return { next: pickFrom[0], stuck: false as const };
}

/**
 * 痕跡（時系列）から「今いそうなセル」のヒートを作る（警察AI用）
 */
function buildHeat(currentTurn: number, visits: Record<string, number[]>, revealed: Record<string, boolean>): number[][] {
  const heat: number[][] = Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => 0.0001));

  const traces: { cell: Cell; t: number }[] = [];
  for (const k of Object.keys(revealed)) {
    if (!revealed[k]) continue;
    const v = visits[k];
    if (!v || v.length === 0) continue;
    const t = Math.min(...v);
    const [r, c] = k.split(",").map((x) => parseInt(x, 10));
    traces.push({ cell: { r, c }, t });
  }

  if (traces.length === 0) {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) heat[r][c] = 1;
    return heat;
  }

  const maxT = Math.max(...traces.map((x) => x.t));

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      let score = 1.0;
      const p: Cell = { r, c };

      for (const tr of traces) {
        const delta = Math.max(0, currentTurn - tr.t);
        const d = manhattanCell(p, tr.cell);

        if (d > delta) {
          score *= 0.02;
          continue;
        }

        const freshness = 1 + (tr.t / Math.max(1, maxT)) * 1.5;
        const closeness = Math.exp(-Math.abs(delta - d) / (1.2 / freshness));
        score *= 0.15 + 0.85 * closeness;
      }

      heat[r][c] = score;
    }
  }

  let mx = 0;
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) mx = Math.max(mx, heat[r][c]);
  if (mx > 0) {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) heat[r][c] /= mx;
  }
  return heat;
}

function bestCellByHeat(heat: number[][]): Cell {
  let best: Cell = { r: 0, c: 0 };
  let bestV = -1;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const v = heat[r][c] + Math.random() * 0.002;
      if (v > bestV) {
        bestV = v;
        best = { r, c };
      }
    }
  }
  return best;
}

function bestSearchTarget(node: Node, heat: number[][], searched: Record<string, boolean>): Cell {
  const cand = surroundingCells(node);
  const scored = cand.map((c) => {
    const k = keyCell(c);
    const hs = heat[c.r][c.c];
    const ns = searched[k] ? 0 : 1;
    const score = hs * 2.0 + ns * 0.6 + Math.random() * 0.01;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

function bestMoveNodeToward(node: Node, target: Cell): Node {
  const neigh = neighborsNode(node);
  if (neigh.length === 0) return node;

  let best = neigh[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const n of neigh) {
    const around = surroundingCells(n);
    const d = Math.min(...around.map((a) => manhattanCell(a, target)));
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

type GameState = {
  role: Role | null;
  phase: Phase;

  turn: number; // 犯人の滞在ターン（初期位置=1）

  helicopters: Node[]; // 0..3
  selectedHeli: number | null;
  actionsLeft: number;
  heliActed: boolean[]; // length 3

  criminalPos: Cell | null;
  visits: Record<string, number[]>;
  revealed: Record<string, boolean>;
  searched: Record<string, boolean>;
  criminalPath: Cell[];

  policeAiThinking: boolean;

  criminalMoving: boolean;
  moveWaitSec: 5 | 10 | 15;

  winner: "POLICE" | "CRIMINAL" | null;
};

export default function App() {
  const aiTimersRef = useRef<number[]>([]);
  const aiRunningRef = useRef(false);

  function clearAiTimers() {
    aiRunningRef.current = false;
    for (const t of aiTimersRef.current) window.clearTimeout(t);
    aiTimersRef.current = [];
  }

  const [policeSearchMode, setPoliceSearchMode] = useState(false);

  const [state, setState] = useState<GameState>(() => ({
    role: null,
    phase: "ROLE_SELECT",
    turn: 1,

    helicopters: [],
    selectedHeli: null,
    actionsLeft: ACTIONS_PER_TURN,
    heliActed: [false, false, false],

    criminalPos: null,
    visits: {},
    revealed: {},
    searched: {},
    criminalPath: [],

    policeAiThinking: false,

    criminalMoving: false,
    moveWaitSec: 5,

    winner: null,
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

  useEffect(() => {
    return () => clearAiTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    clearAiTimers();
    setPoliceSearchMode(false);
    setState({
      role: null,
      phase: "ROLE_SELECT",
      turn: 1,
      helicopters: [],
      selectedHeli: null,
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
      criminalPos: null,
      visits: {},
      revealed: {},
      searched: {},
      criminalPath: [],
      policeAiThinking: false,
      criminalMoving: false,
      moveWaitSec: 5,
      winner: null,
    });
  }

  // ===== ROLE SELECT =====
  function chooseRole(role: Role) {
    clearAiTimers();
    setPoliceSearchMode(false);

    if (role === "POLICE") {
      // 警察プレイヤー：犯人AIは初期位置をランダムに選ぶ
      const c0 = randomCell();
      const visits: Record<string, number[]> = {};
      visits[keyCell(c0)] = [1];

      setState((s) => ({
        ...s,
        role,
        phase: "POLICE_SETUP",
        turn: 1,
        helicopters: [],
        selectedHeli: null,
        actionsLeft: ACTIONS_PER_TURN,
        heliActed: [false, false, false],
        criminalPos: c0,
        visits,
        revealed: {},
        searched: {},
        criminalPath: [c0],
        winner: null,
        criminalMoving: false,
        policeAiThinking: false,
      }));
    } else {
      // 犯人プレイヤー：警察AIはヘリをランダム配置、犯人は初期位置を選ぶ
      const helis = uniqueRandomNodes(3);
      setState((s) => ({
        ...s,
        role,
        phase: "CRIMINAL_HIDE",
        turn: 1,
        helicopters: helis,
        selectedHeli: null,
        actionsLeft: ACTIONS_PER_TURN,
        heliActed: [false, false, false],
        criminalPos: null,
        visits: {},
        revealed: {},
        searched: {},
        criminalPath: [],
        winner: null,
        criminalMoving: false,
        policeAiThinking: false,
      }));
    }
  }

  // ===== END ROUTE =====
  const routePoints = useMemo(() => {
    if (state.phase !== "END") return [];
    if (state.criminalPath.length < 2) return [];
    return state.criminalPath.map(cellCenterPct);
  }, [state.phase, state.criminalPath]);

  const polylinePoints = useMemo(() => {
    if (routePoints.length === 0) return "";
    return routePoints.map((p) => `${p.x},${p.y}`).join(" ");
  }, [routePoints]);

  // ===== POLICE PLAYER MODE =====
  function toggleHeliSetup(n: Node) {
    if (state.phase !== "POLICE_SETUP") return;

    const k = keyNode(n);
    const idx = state.helicopters.findIndex((h) => keyNode(h) === k);

    if (idx >= 0) {
      const next = state.helicopters.slice();
      next.splice(idx, 1);
      setState((s) => ({ ...s, helicopters: next }));
      return;
    }
    if (state.helicopters.length >= 3) return;
    setState((s) => ({ ...s, helicopters: [...s.helicopters, n] }));
  }

  function startPoliceTurn() {
    if (state.phase !== "POLICE_SETUP") return;
    if (state.helicopters.length !== 3) return;

    setState((s) => ({
      ...s,
      phase: "POLICE_TURN",
      selectedHeli: 0,
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
    }));
  }

  function selectHeli(i: number) {
    if (state.phase !== "POLICE_TURN") return;
    if (state.criminalMoving) return;
    setState((s) => ({ ...s, selectedHeli: i }));
  }

  function currentHeliCanAct(): boolean {
    if (state.phase !== "POLICE_TURN") return false;
    if (state.selectedHeli == null) return false;
    if (state.actionsLeft <= 0) return false;
    if (state.criminalMoving) return false;
    return !state.heliActed[state.selectedHeli];
  }

  function moveHeliPlayer(to: Node) {
    if (state.phase !== "POLICE_TURN") return;
    if (state.selectedHeli == null) return;
    if (!currentHeliCanAct()) return;

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
    }));
  }

  function enterPoliceSearch() {
    if (state.phase !== "POLICE_TURN") return;
    if (!currentHeliCanAct()) return;
    setPoliceSearchMode(true);
  }
  function cancelPoliceSearch() {
    setPoliceSearchMode(false);
  }

  function searchCellPlayer(target: Cell) {
    if (state.phase !== "POLICE_TURN") return;
    if (state.selectedHeli == null) return;
    if (!policeSearchMode) return;
    if (!currentHeliCanAct()) return;

    const node = state.helicopters[state.selectedHeli];
    const cand = surroundingCells(node);
    const ok = cand.some((c) => c.r === target.r && c.c === target.c);
    if (!ok) return;

    const searched = { ...state.searched, [keyCell(target)]: true };

    // 逮捕
    if (state.criminalPos && target.r === state.criminalPos.r && target.c === state.criminalPos.c) {
      setState((s) => ({ ...s, phase: "END", winner: "POLICE", searched }));
      setPoliceSearchMode(false);
      return;
    }

    // 痕跡開示
    const revealed = { ...state.revealed };
    const v = state.visits[keyCell(target)];
    if (v && v.length > 0 && !revealed[keyCell(target)]) revealed[keyCell(target)] = true;

    const heliActed = state.heliActed.slice();
    heliActed[state.selectedHeli] = true;

    setState((s) => ({
      ...s,
      searched,
      revealed,
      heliActed,
      actionsLeft: s.actionsLeft - 1,
    }));
    setPoliceSearchMode(false);
  }

  function endPoliceTurn() {
    if (state.phase !== "POLICE_TURN") return;
    if (state.criminalMoving) return;

    // 11ターン逃げ切り（犯人勝ち）
    if (state.turn >= MAX_TURN) {
      setState((s) => ({ ...s, phase: "END", winner: "CRIMINAL" }));
      return;
    }

    const nextTurn = state.turn + 1;

    // 犯人AIが 5/10/15 秒待ってから必ず移動（待機NGなので“詰み回避”で動ける手を選ぶ）
    const wait: 5 | 10 | 15 = pickRandom([5, 10, 15] as const);
    clearAiTimers();
    setState((s) => ({ ...s, phase: "CRIMINAL_AI_MOVING", criminalMoving: true, moveWaitSec: wait }));

    const t = window.setTimeout(() => {
      setState((prev) => {
        if (prev.role !== "POLICE") return prev;
        if (!prev.criminalPos) return prev;

        const mv = criminalAiNextMoveNoStuck(prev.criminalPos, prev.visits, prev.turn);

        // 念のための最終保険：万一“完全詰み”に来たら「詰み負け」を発生させない（犯人勝ち扱い）
        if (mv.stuck) {
          return { ...prev, phase: "END", winner: "CRIMINAL", criminalMoving: false };
        }

        const visits = { ...prev.visits };
        visits[keyCell(mv.next)] = Array.from(new Set([...(visits[keyCell(mv.next)] ?? []), nextTurn]));

        return {
          ...prev,
          turn: nextTurn,
          criminalPos: mv.next,
          visits,
          criminalPath: [...prev.criminalPath, mv.next],
          phase: "POLICE_TURN",
          actionsLeft: ACTIONS_PER_TURN,
          heliActed: [false, false, false],
          selectedHeli: 0,
          criminalMoving: false,
        };
      });
    }, wait * 1000);

    aiTimersRef.current.push(t);
  }

  // 行動残り0で自動ターン終了（警察プレイヤー）
  useEffect(() => {
    if (state.phase !== "POLICE_TURN") return;
    if (state.actionsLeft !== 0) return;
    if (state.criminalMoving) return;
    const t = window.setTimeout(() => endPoliceTurn(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.actionsLeft, state.criminalMoving]);

  // ===== CRIMINAL PLAYER MODE =====
  function criminalChooseStart(c: Cell) {
    if (state.phase !== "CRIMINAL_HIDE") return;
    if (state.criminalPos != null) return;

    const visits = { ...state.visits };
    visits[keyCell(c)] = [1];

    setState((s) => ({
      ...s,
      criminalPos: c,
      visits,
      criminalPath: [c],
      phase: "POLICE_AI_TURN",
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
      selectedHeli: null,
    }));
  }

  function criminalMoveTo(c: Cell) {
    if (state.phase !== "CRIMINAL_MOVE") return;
    if (!state.criminalPos) return;

    const neigh = neighborsCell(state.criminalPos);
    const isNeighbor = neigh.some((n) => n.r === c.r && n.c === c.c);
    if (!isNeighbor) return;

    const visited = new Set(Object.keys(state.visits));
    if (visited.has(keyCell(c))) return;

    const nextTurn = state.turn + 1;

    const visits = { ...state.visits };
    visits[keyCell(c)] = Array.from(new Set([...(visits[keyCell(c)] ?? []), nextTurn]));

    setState((s) => ({
      ...s,
      turn: nextTurn,
      criminalPos: c,
      visits,
      criminalPath: [...s.criminalPath, c],
      phase: "POLICE_AI_TURN",
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
      selectedHeli: null,
    }));
  }

  function runPoliceAiTurn() {
    if (aiRunningRef.current) return;
    aiRunningRef.current = true;

    setState((s) => ({ ...s, policeAiThinking: true }));

    const stepDelay = 900;
    const steps = ACTIONS_PER_TURN;

    for (let i = 0; i < steps; i++) {
      const t = window.setTimeout(() => {
        if (!aiRunningRef.current) return;

        setState((prev) => {
          if (prev.phase !== "POLICE_AI_TURN") return prev;
          if (!prev.criminalPos) return prev;
          if (prev.actionsLeft <= 0) return prev;

          const heat = buildHeat(prev.turn, prev.visits, prev.revealed);

          const candidates = [0, 1, 2].filter((idx) => !prev.heliActed[idx]);
          if (candidates.length === 0) return prev;

          const heliIndex = pickRandom(candidates as const);
          const heliNode = prev.helicopters[heliIndex];

          const hasAnyTrace = Object.values(prev.revealed).some(Boolean);
          const doMove = Math.random() < (hasAnyTrace ? 0.55 : 0.3);

          if (doMove) {
            const target = bestCellByHeat(heat);
            const to = bestMoveNodeToward(heliNode, target);

            const helicopters = prev.helicopters.slice();
            helicopters[heliIndex] = to;

            const heliActed = prev.heliActed.slice();
            heliActed[heliIndex] = true;

            return {
              ...prev,
              helicopters,
              heliActed,
              selectedHeli: heliIndex,
              actionsLeft: prev.actionsLeft - 1,
            };
          }

          const target = bestSearchTarget(heliNode, heat, prev.searched);
          const searched = { ...prev.searched, [keyCell(target)]: true };

          if (target.r === prev.criminalPos.r && target.c === prev.criminalPos.c) {
            aiRunningRef.current = false;
            return {
              ...prev,
              phase: "END",
              winner: "POLICE",
              selectedHeli: heliIndex,
              actionsLeft: 0,
              policeAiThinking: false,
              searched,
            };
          }

          const revealed = { ...prev.revealed };
          const v = prev.visits[keyCell(target)];
          if (v && v.length > 0 && !revealed[keyCell(target)]) revealed[keyCell(target)] = true;

          const heliActed = prev.heliActed.slice();
          heliActed[heliIndex] = true;

          return {
            ...prev,
            searched,
            revealed,
            heliActed,
            selectedHeli: heliIndex,
            actionsLeft: prev.actionsLeft - 1,
          };
        });

        if (i === steps - 1) {
          const t2 = window.setTimeout(() => {
            setState((prev) => {
              if (prev.phase !== "POLICE_AI_TURN") return prev;

              if (prev.turn >= MAX_TURN) {
                aiRunningRef.current = false;
                return { ...prev, phase: "END", winner: "CRIMINAL", policeAiThinking: false, selectedHeli: null };
              }

              aiRunningRef.current = false;
              return { ...prev, phase: "CRIMINAL_MOVE", policeAiThinking: false, selectedHeli: null };
            });
          }, 600);
          aiTimersRef.current.push(t2);
        }
      }, 600 + i * stepDelay);

      aiTimersRef.current.push(t);
    }
  }

  useEffect(() => {
    if (state.phase !== "POLICE_AI_TURN") return;
    if (!state.criminalPos) return;
    if (state.winner) return;
    clearAiTimers();
    runPoliceAiTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.criminalPos, state.winner]);

  // ===== UI helpers =====
  const visitedSet = useMemo(() => new Set(Object.keys(state.visits)), [state.visits]);

  function canTapCell(c: Cell): boolean {
    if (state.role === "CRIMINAL") {
      if (state.phase === "CRIMINAL_HIDE" && state.criminalPos == null) return true;
      if (state.phase === "CRIMINAL_MOVE" && state.criminalPos) {
        const neigh = neighborsCell(state.criminalPos);
        const isNeighbor = neigh.some((n) => n.r === c.r && n.c === c.c);
        if (!isNeighbor) return false;
        if (visitedSet.has(keyCell(c))) return false;
        return true;
      }
      return false;
    }

    if (state.role === "POLICE") {
      if (state.phase === "POLICE_TURN" && policeSearchMode && state.selectedHeli != null) {
        const node = state.helicopters[state.selectedHeli];
        const cand = surroundingCells(node);
        return cand.some((x) => x.r === c.r && x.c === c.c);
      }
      return false;
    }

    return false;
  }

  function onCellTap(c: Cell) {
    if (!canTapCell(c)) return;

    if (state.role === "CRIMINAL") {
      if (state.phase === "CRIMINAL_HIDE") criminalChooseStart(c);
      else if (state.phase === "CRIMINAL_MOVE") criminalMoveTo(c);
      return;
    }

    if (state.role === "POLICE") {
      if (state.phase === "POLICE_TURN" && policeSearchMode) searchCellPlayer(c);
    }
  }

  function onNodeTap(n: Node) {
    if (state.phase === "POLICE_SETUP") return toggleHeliSetup(n);

    if (state.phase === "POLICE_TURN") {
      if (state.criminalMoving) return;

      const idx = state.helicopters.findIndex((h) => keyNode(h) === keyNode(n));
      if (idx >= 0) return selectHeli(idx);

      if (state.selectedHeli == null) return;
      moveHeliPlayer(n);
    }
  }

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
      cursor: "default",
      position: "relative",
    };

    if (isRevealed && first != null) {
      base.background = traceColor(first);
      base.opacity = 1;
      base.outline = "2px solid rgba(0,0,0,0.12)";
    }

    // 犯人側：移動候補だけ明るく＆太枠、その他暗く、再訪はさらに暗く＋🚫
    const isCriminalMovePhase = state.role === "CRIMINAL" && state.phase === "CRIMINAL_MOVE" && state.criminalPos != null;
    if (isCriminalMovePhase) {
      const neigh = neighborsCell(state.criminalPos!);
      const isNeighbor = neigh.some((n) => n.r === c.r && n.c === c.c);
      const isVisited = visitedSet.has(k);

      if (isNeighbor && !isVisited) {
        base.outline = "4px solid rgba(255,255,255,0.95)";
        base.background = "#2563eb";
        base.cursor = "pointer";
        base.opacity = 1;
      } else {
        base.opacity = isVisited ? 0.32 : 0.55;
      }
    }

    // 犯人初期選択：全セルタップ可
    const isCriminalHide = state.role === "CRIMINAL" && state.phase === "CRIMINAL_HIDE" && state.criminalPos == null;
    if (isCriminalHide) {
      base.outline = "2px solid rgba(255,255,255,0.35)";
      base.cursor = "pointer";
    }

    // END時：最終位置を赤地
    if (state.phase === "END" && state.criminalPos && state.criminalPos.r === c.r && state.criminalPos.c === c.c) {
      base.background = "#991b1b";
      base.outline = "3px solid rgba(255,255,255,0.9)";
      base.opacity = 1;
    }

    return base;
  }

  const phaseLabel =
    state.phase === "ROLE_SELECT"
      ? "SELECT"
      : state.phase === "POLICE_SETUP"
      ? "SETUP"
      : state.phase === "POLICE_TURN"
      ? "POLICE"
      : state.phase === "CRIMINAL_AI_MOVING"
      ? "CRIMINAL(AI)"
      : state.phase === "CRIMINAL_HIDE"
      ? "CRIMINAL"
      : state.phase === "POLICE_AI_TURN"
      ? "POLICE(AI)"
      : state.phase === "CRIMINAL_MOVE"
      ? "CRIMINAL"
      : "END";

  return (
    <div style={{ padding: 12, maxWidth: 560, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
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
            <div style={{ fontSize: 22, fontWeight: 900 }}>{phaseLabel}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#111" }}>
              行動残り：{state.phase === "POLICE_TURN" || state.phase === "POLICE_AI_TURN" ? state.actionsLeft : "-"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={reset} style={{ height: 38, flex: 1 }}>
            リセット
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#374151", lineHeight: 1.4 }}>
          {state.phase === "ROLE_SELECT" && "プレイモードを選択してください（犯人 or 警察）。"}
          {state.phase === "POLICE_SETUP" && "警察：ヘリを3機配置してください（交差点タップ）。"}
          {state.phase === "POLICE_TURN" && "警察：1ターン3行動（各ヘリ1回）。移動 or 捜索（周囲4ビルから1つ）。"}
          {state.phase === "CRIMINAL_AI_MOVING" && "犯人AIが移動中…"}
          {state.phase === "CRIMINAL_HIDE" && "犯人：最初に隠れるビルをタップして決めてください。"}
          {state.phase === "POLICE_AI_TURN" &&
            (state.policeAiThinking ? "警察AIが行動中（痕跡の時系列で推理中）…" : "警察AIのターン")}
          {state.phase === "CRIMINAL_MOVE" && "犯人：移動候補（隣接かつ未訪問）だけ明るく表示されています（再訪不可）。"}
          {state.phase === "END" &&
            (state.winner === "CRIMINAL" ? "犯人の勝ち" : "警察の勝ち") + "：白線が犯人ルートです（S=開始 / E=終了）。"}
        </div>
      </header>

      <main style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {state.phase === "ROLE_SELECT" && (
          <section style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => chooseRole("CRIMINAL")}
              style={{
                flex: 1,
                height: 56,
                fontWeight: 900,
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#111827",
                color: "#fff",
              }}
            >
              犯人で遊ぶ（警察AI）
            </button>
            <button
              onClick={() => chooseRole("POLICE")}
              style={{
                flex: 1,
                height: 56,
                fontWeight: 900,
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#0ea5e9",
                color: "#fff",
              }}
            >
              警察で遊ぶ（犯人AI）
            </button>
          </section>
        )}

        <section>
          <div style={{ position: "relative", width: "100%", maxWidth: 480, margin: "0 auto", aspectRatio: "1 / 1" }}>
            {/* Buildings */}
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
                const style = cellStyle(c);
                const tappable = canTapCell(c);

                const showNoEntry =
                  state.role === "CRIMINAL" &&
                  state.phase === "CRIMINAL_MOVE" &&
                  visitedSet.has(k) &&
                  !(state.criminalPos && state.criminalPos.r === c.r && state.criminalPos.c === c.c);

                // 車表示：
                // - 犯人モード：犯人ターン（hide/move）とENDで表示、警察AIターン中は非表示
                // - 警察モード：ENDのみ表示
                const showCar =
                  state.criminalPos &&
                  ((state.role === "CRIMINAL" && (state.phase === "CRIMINAL_HIDE" || state.phase === "CRIMINAL_MOVE" || state.phase === "END")) ||
                    (state.role === "POLICE" && state.phase === "END")) &&
                  state.criminalPos.r === c.r &&
                  state.criminalPos.c === c.c;

                return (
                  <div key={k} style={style} onClick={() => (tappable ? onCellTap(c) : undefined)}>
                    {showCar ? <span style={{ fontSize: 22 }}>🚗</span> : null}
                    {showNoEntry ? (
                      <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 14, opacity: 0.95 }}>🚫</span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Route on END */}
            {state.phase === "END" && routePoints.length > 0 && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, borderRadius: 16, pointerEvents: "none" }}>
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="rgba(255,255,255,0.90)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {routePoints.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === 0 || i === routePoints.length - 1 ? 2.2 : 1.6}
                    fill={
                      i === 0 ? "rgba(34,197,94,0.95)" : i === routePoints.length - 1 ? "rgba(239,68,68,0.95)" : "rgba(255,255,255,0.85)"
                    }
                    stroke="rgba(0,0,0,0.25)"
                    strokeWidth="0.4"
                  />
                ))}
                <text x={routePoints[0].x + 1.6} y={routePoints[0].y - 1.6} fontSize="3.6" fill="rgba(34,197,94,0.95)" fontWeight="700">
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
              </svg>
            )}

            {/* Nodes / Helicopters */}
            {allNodes.map((n) => {
              const k = keyNode(n);
              const placedIndex = state.helicopters.findIndex((h) => keyNode(h) === k);
              const placed = placedIndex >= 0;

              const isSelected = state.selectedHeli != null && placedIndex === state.selectedHeli;
              const acted = placedIndex >= 0 ? state.heliActed[placedIndex] : false;

              const leftPct = ((n.c + 1) / GRID) * 100;
              const topPct = ((n.r + 1) / GRID) * 100;

              // 警察プレイヤーの移動候補表示
              let isMoveCandidate = false;
              if (
                state.phase === "POLICE_TURN" &&
                state.selectedHeli != null &&
                state.actionsLeft > 0 &&
                !state.heliActed[state.selectedHeli] &&
                !state.criminalMoving
              ) {
                const from = state.helicopters[state.selectedHeli];
                isMoveCandidate = neighborsNode(from).some((x) => keyNode(x) === k);
              }

              const heliColor = placed ? getHeliColor(placedIndex) : "rgba(255,255,255,0.85)";
              const clickable = state.phase === "POLICE_SETUP" || state.phase === "POLICE_TURN";

              return (
                <button
                  key={k}
                  onClick={() => (clickable ? onNodeTap(n) : undefined)}
                  disabled={!clickable || state.criminalMoving}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    transform: "translate(-50%, -50%)",
                    width: 44,
                    height: 44,
                    borderRadius: 999,
                    border:
                      state.phase === "POLICE_SETUP"
                        ? placed
                          ? "3px solid #111827"
                          : "3px solid rgba(255,255,255,0.7)"
                        : placed
                        ? `3px solid ${isSelected ? "#0ea5e9" : "#111827"}`
                        : isMoveCandidate
                        ? "3px solid #0ea5e9"
                        : "2px solid rgba(17,24,39,0.45)",
                    background: heliColor,
                    boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
                    fontSize: 18,
                    fontWeight: 900,
                    cursor: !clickable || state.criminalMoving ? "not-allowed" : "pointer",
                    opacity: placed && acted ? 0.55 : 1,
                    color: placedIndex === 2 ? "#111" : "#fff",
                  }}
                  title={
                    state.phase === "POLICE_SETUP"
                      ? "ヘリを配置/解除"
                      : placed
                      ? acted
                        ? "行動済み"
                        : "ヘリを選択"
                      : "移動先（隣接のみ）"
                  }
                >
                  {placed ? "🚁" : "·"}
                </button>
              );
            })}

            {/* overlays */}
            {(state.phase === "POLICE_AI_TURN" || state.phase === "CRIMINAL_AI_MOVING") && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  background: "rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                  pointerEvents: "none",
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
                  <div style={{ fontSize: 18, fontWeight: 900 }}>
                    {state.phase === "POLICE_AI_TURN" ? "警察AIが行動中…" : "犯人AIが移動中…"}
                  </div>
                  <div style={{ fontSize: 26, marginTop: 10 }}>{state.phase === "POLICE_AI_TURN" ? "🚁🔎" : "🚗💨"}</div>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {state.phase === "POLICE_SETUP" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setState((s) => ({ ...s, helicopters: [], selectedHeli: null }))} style={{ flex: 1, height: 44 }}>
                配置をやり直す
              </button>
              <button disabled={state.helicopters.length !== 3} onClick={startPoliceTurn} style={{ flex: 1, height: 44, fontWeight: 900 }}>
                この配置で開始
              </button>
            </div>
          )}

          {state.phase === "POLICE_TURN" && (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={!currentHeliCanAct()} onClick={enterPoliceSearch} style={{ flex: 1, height: 48, fontWeight: 900 }}>
                  捜索する（1行動）
                </button>
                <button disabled={!policeSearchMode} onClick={cancelPoliceSearch} style={{ width: 120, height: 48 }}>
                  捜索取消
                </button>
              </div>

              <button onClick={endPoliceTurn} disabled={state.criminalMoving} style={{ height: 44 }}>
                ターン終了（残り行動を捨てる）
              </button>

              {policeSearchMode && <div style={{ fontSize: 12, color: "#666" }}>周囲4ビルのどれか1つをタップして捜索してください。</div>}
            </div>
          )}
        </section>
      </main>

      <footer style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
        ※犯人AIは「詰み負け（移動先ゼロ）」が起きないように先読みで移動します（待機はしません）。
      </footer>
    </div>
  );
}
