import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type Role = "POLICE" | "CRIMINAL";
type Mode = "SINGLE" | "PASS_PLAY";

type Phase =
  | "ROLE_SELECT"
  | "POLICE_SETUP"
  | "POLICE_TURN"
  | "CRIMINAL_AI_MOVING"
  | "CRIMINAL_HIDE"
  | "POLICE_AI_TURN"
  | "CRIMINAL_MOVE"
  | "END";

type Viewer = "POLICE" | "CRIMINAL";

type Cell = { r: number; c: number }; // 0..4
type Node = { r: number; c: number }; // 0..3

type SearchMark = { turn: number; target: Cell; heliIndex: number };

const GRID = 5;
const NODE = 4;
const MAX_TURN = 11;
const ACTIONS_PER_TURN = 3;
const ROAD_GAP = 22;

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
  if (index === 0) return "#22c55e";
  if (index === 1) return "#ef4444";
  return "#facc15";
}

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
 */
function criminalAiNextMoveNoStuck(current: Cell, visits: Record<string, number[]>, currentTurn: number) {
  const visited = new Set(Object.keys(visits));
  const remainingMoves = MAX_TURN - currentTurn;

  const nextCandidates = neighborsCell(current).filter((n) => !visited.has(keyCell(n)));
  if (nextCandidates.length === 0) {
    return { next: current, stuck: true as const };
  }

  function canFinishFrom(pos: Cell, stepsLeft: number, visitedSet: Set<string>): boolean {
    if (stepsLeft <= 0) return true;

    const neigh = neighborsCell(pos).filter((n) => !visitedSet.has(keyCell(n)));
    if (neigh.length === 0) return false;

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

/**
 * ヘリが重ならないように移動先を選ぶ（occupied を避ける）
 */
function bestMoveNodeTowardAvoidOccupied(node: Node, target: Cell, occupied: Set<string>): Node {
  const neigh = neighborsNode(node).filter((n) => !occupied.has(keyNode(n)));
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
  mode: Mode;
  role: Role | null; // SINGLE時：プレイヤーの役割 / PASS時：null
  viewer: Viewer; // PASS時：いま端末を見ている人
  phase: Phase;

  turn: number;

  helicopters: Node[];
  selectedHeli: number | null;
  actionsLeft: number;
  heliActed: boolean[];

  criminalPos: Cell | null;
  visits: Record<string, number[]>;
  revealed: Record<string, boolean>;
  searched: Record<string, boolean>;
  criminalPath: Cell[];

  // ✅ 「直前の警察AIの捜索」3つを残す
  lastPoliceSearches: SearchMark[];

  policeAiThinking: boolean;

  criminalMoving: boolean;
  moveWaitSec: 5 | 10 | 15;

  winner: "POLICE" | "CRIMINAL" | null;

  handoff: { show: boolean; to: Viewer; message: string };
};

export default function App() {
  const aiTimersRef = useRef<number[]>([]);
  const aiRunningRef = useRef(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardPx, setBoardPx] = useState(0);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const update = () => setBoardPx(el.clientWidth || 0);
    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);


  function clearAiTimers() {
    aiRunningRef.current = false;
    for (const t of aiTimersRef.current) window.clearTimeout(t);
    aiTimersRef.current = [];
  }

  // ★捜索モード（true=捜索、false=移動）
  const [policeSearchMode, setPoliceSearchMode] = useState(false);

  const [state, setState] = useState<GameState>(() => ({
    mode: "SINGLE",
    role: null,
    viewer: "POLICE",
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

    lastPoliceSearches: [],

    policeAiThinking: false,

    criminalMoving: false,
    moveWaitSec: 5,

    winner: null,

    handoff: { show: false, to: "POLICE", message: "" },
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

  // ボタンのベーススタイル
  const baseButtonStyle: React.CSSProperties = {
    appearance: "none",
    WebkitAppearance: "none",
    border: "1px solid rgba(17,24,39,0.18)",
    borderRadius: 14,
    height: 48,
    padding: "0 12px",
    fontSize: 16,
    fontWeight: 900,
    lineHeight: "48px",
    boxSizing: "border-box",
    background: "#ffffff",
    color: "#111827",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
    cursor: "pointer",
    outline: "none",
  };

  useEffect(() => {
    return () => clearAiTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    clearAiTimers();
    setPoliceSearchMode(false);
    setState({
      mode: "SINGLE",
      role: null,
      viewer: "POLICE",
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
      lastPoliceSearches: [],
      policeAiThinking: false,
      criminalMoving: false,
      moveWaitSec: 5,
      winner: null,
      handoff: { show: false, to: "POLICE", message: "" },
    });
  }

  function showHandoff(to: Viewer, message: string, nextPhase?: Phase) {
    setState((s) => ({
      ...s,
      ...(nextPhase ? { phase: nextPhase } : {}),
      handoff: { show: true, to, message },
    }));
  }
  function acceptHandoff() {
    setState((s) => ({
      ...s,
      viewer: s.handoff.to,
      handoff: { show: false, to: s.handoff.to, message: "" },
    }));
  }

  // ===== モード選択（SINGLEは従来 / PASS_PLAYは同端末対戦） =====
  function choosePassPlay() {
    clearAiTimers();
    setPoliceSearchMode(false);
    setState((s) => ({
      ...s,
      mode: "PASS_PLAY",
      role: null,
      viewer: "POLICE",
      phase: "POLICE_SETUP",
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
      lastPoliceSearches: [],
      winner: null,
      criminalMoving: false,
      policeAiThinking: false,
      handoff: { show: false, to: "POLICE", message: "" },
    }));
  }

  function chooseRoleSingle(role: Role) {
    clearAiTimers();
    setPoliceSearchMode(false);

    if (role === "POLICE") {
      const c0 = randomCell();
      const visits: Record<string, number[]> = {};
      visits[keyCell(c0)] = [1];

      setState((s) => ({
        ...s,
        mode: "SINGLE",
        role,
        viewer: "POLICE",
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
        lastPoliceSearches: [],
        winner: null,
        criminalMoving: false,
        policeAiThinking: false,
        handoff: { show: false, to: "POLICE", message: "" },
      }));
    } else {
      // ✅ ソロ：犯人（警察AI）
      const helis = uniqueRandomNodes(3);
      setState((s) => ({
        ...s,
        mode: "SINGLE",
        role,
        viewer: "CRIMINAL",
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
        lastPoliceSearches: [],
        winner: null,
        criminalMoving: false,
        policeAiThinking: false,
        handoff: { show: false, to: "CRIMINAL", message: "" },
      }));
    }
  }

  const routePoints = useMemo(() => {
    if (state.phase !== "END") return [];
    if (state.criminalPath.length < 2) return [];
    return state.criminalPath.map(cellCenterPct);
  }, [state.phase, state.criminalPath]);

  const polylinePoints = useMemo(() => {
    if (routePoints.length === 0) return "";
    return routePoints.map((p) => `${p.x},${p.y}`).join(" ");
  }, [routePoints]);

  function toggleHeliSetup(n: Node) {
    if (state.phase !== "POLICE_SETUP") return;
    if (state.mode === "PASS_PLAY" && state.viewer !== "POLICE") return;

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

  function startFromSetup() {
    if (state.phase !== "POLICE_SETUP") return;
    if (state.helicopters.length !== 3) return;

    setPoliceSearchMode(false);

    if (state.mode === "PASS_PLAY") {
      setState((s) => ({
        ...s,
        phase: "CRIMINAL_HIDE",
        selectedHeli: null,
        actionsLeft: ACTIONS_PER_TURN,
        heliActed: [false, false, false],
      }));
      showHandoff("CRIMINAL", "犯人に端末を渡してください。犯人はヘリ配置を見た上で初期位置を選びます。");
      return;
    }

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
    if (state.mode === "PASS_PLAY" && state.viewer !== "POLICE") return;
    setState((s) => ({ ...s, selectedHeli: i }));
  }

  function currentHeliCanAct(): boolean {
    if (state.phase !== "POLICE_TURN") return false;
    if (state.selectedHeli == null) return false;
    if (state.actionsLeft <= 0) return false;
    if (state.criminalMoving) return false;
    if (state.mode === "PASS_PLAY" && state.viewer !== "POLICE") return false;
    return !state.heliActed[state.selectedHeli];
  }

  function moveHeliPlayer(to: Node) {
    if (state.phase !== "POLICE_TURN") return;
    if (state.selectedHeli == null) return;
    if (!currentHeliCanAct()) return;

    const occupied = new Set(state.helicopters.map(keyNode));
    occupied.delete(keyNode(state.helicopters[state.selectedHeli]));
    if (occupied.has(keyNode(to))) return;

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

  function setPoliceModeSearch() {
    if (state.phase !== "POLICE_TURN") return;
    if (!currentHeliCanAct()) return;
    setPoliceSearchMode(true);
  }
  function setPoliceModeMove() {
    if (state.phase !== "POLICE_TURN") return;
    if (state.mode === "PASS_PLAY" && state.viewer !== "POLICE") return;
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

    if (state.criminalPos && target.r === state.criminalPos.r && target.c === state.criminalPos.c) {
      setState((s) => ({ ...s, phase: "END", winner: "POLICE", searched }));
      return;
    }

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
  }

  function endPoliceTurn() {
    if (state.phase !== "POLICE_TURN") return;
    if (state.criminalMoving) return;

    if (state.turn >= MAX_TURN) {
      setState((s) => ({ ...s, phase: "END", winner: "CRIMINAL" }));
      return;
    }

    const nextTurn = state.turn + 1;

    if (state.mode === "PASS_PLAY") {
      setState((s) => ({
        ...s,
        phase: "CRIMINAL_MOVE",
        actionsLeft: ACTIONS_PER_TURN,
        heliActed: s.heliActed,
        selectedHeli: null,
      }));
      showHandoff("CRIMINAL", "犯人に端末を渡してください。犯人は1回だけ移動します（待機NG / 再訪NG）。");
      return;
    }

    // SINGLE：犯人AI移動（警察プレイ時）
    const wait: 5 | 10 | 15 = pickRandom([5, 10, 15] as const);
    clearAiTimers();
    setState((s) => ({ ...s, phase: "CRIMINAL_AI_MOVING", criminalMoving: true, moveWaitSec: wait }));

    const t = window.setTimeout(() => {
      setState((prev) => {
        if (prev.role !== "POLICE") return prev;
        if (!prev.criminalPos) return prev;

        const mv = criminalAiNextMoveNoStuck(prev.criminalPos, prev.visits, prev.turn);

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

  // 行動が0になったら自動でターン終了
  useEffect(() => {
    if (state.phase !== "POLICE_TURN") return;
    if (state.actionsLeft !== 0) return;
    if (state.criminalMoving) return;
    const t = window.setTimeout(() => endPoliceTurn(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.actionsLeft, state.criminalMoving]);

  function criminalChooseStart(c: Cell) {
    if (state.phase !== "CRIMINAL_HIDE") return;

    if (state.mode === "PASS_PLAY" && state.viewer !== "CRIMINAL") return;

    if (state.criminalPos != null) return;

    const visits = { ...state.visits };
    visits[keyCell(c)] = [1];

    if (state.mode === "PASS_PLAY") {
      setState((s) => ({
        ...s,
        criminalPos: c,
        visits,
        criminalPath: [c],
        phase: "POLICE_TURN",
        actionsLeft: ACTIONS_PER_TURN,
        heliActed: [false, false, false],
        selectedHeli: 0,
      }));
      showHandoff("POLICE", "警察に端末を渡してください。警察は3回行動（ヘリは毎回選び直しOK）。");
      return;
    }

    // SINGLE（犯人プレイ）：警察AIターンへ
    setState((s) => ({
      ...s,
      criminalPos: c,
      visits,
      criminalPath: [c],
      phase: "POLICE_AI_TURN",
      actionsLeft: ACTIONS_PER_TURN,
      heliActed: [false, false, false],
      selectedHeli: null,
      lastPoliceSearches: [],
    }));
  }

  function criminalMoveTo(c: Cell) {
    if (state.phase !== "CRIMINAL_MOVE") return;
    if (!state.criminalPos) return;

    if (state.mode === "PASS_PLAY" && state.viewer !== "CRIMINAL") return;

    const neigh = neighborsCell(state.criminalPos);
    const isNeighbor = neigh.some((n) => n.r === c.r && n.c === c.c);
    if (!isNeighbor) return;

    const visited = new Set(Object.keys(state.visits));
    if (visited.has(keyCell(c))) return;

    const nextTurn = state.turn + 1;

    const visits = { ...state.visits };
    visits[keyCell(c)] = Array.from(new Set([...(visits[keyCell(c)] ?? []), nextTurn]));

    if (state.mode === "PASS_PLAY") {
      setState((s) => ({
        ...s,
        turn: nextTurn,
        criminalPos: c,
        visits,
        criminalPath: [...s.criminalPath, c],
        phase: "POLICE_TURN",
        actionsLeft: ACTIONS_PER_TURN,
        heliActed: [false, false, false],
        selectedHeli: 0,
      }));
      showHandoff("POLICE", "警察に端末を渡してください。次の警察ターンです（3回行動）。");
      return;
    }

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
      lastPoliceSearches: [],
    }));
  }

  // ===== 警察AIターン（ソロ犯人のときだけ動く） =====
  function runPoliceAiTurn() {
    if (aiRunningRef.current) return;
    aiRunningRef.current = true;

    setState((s) => ({ ...s, policeAiThinking: true }));

    const stepDelay = 850;

    // ✅ 必ず3機とも行動する（順番に未行動ヘリを選ぶ）
    for (let i = 0; i < ACTIONS_PER_TURN; i++) {
      const t = window.setTimeout(() => {
        if (!aiRunningRef.current) return;

        setState((prev) => {
          if (prev.phase !== "POLICE_AI_TURN") return prev;
          if (!prev.criminalPos) return prev;
          if (prev.actionsLeft <= 0) return prev;

          const heat = buildHeat(prev.turn, prev.visits, prev.revealed);

          const remaining = [0, 1, 2].filter((idx) => !prev.heliActed[idx]);
          if (remaining.length === 0) return prev;

          // 「必ず全機行動」なので、ランダムではなく先頭（未行動）を使う
          const heliIndex = remaining[0] as 0 | 1 | 2;
          const heliNode = prev.helicopters[heliIndex];

          const hasAnyTrace = Object.values(prev.revealed).some(Boolean);
          const isLastTurn = prev.turn >= MAX_TURN;

          // 最終ターンは移動しない（既存仕様）
          const preferMove = isLastTurn ? false : Math.random() < (hasAnyTrace ? 0.55 : 0.3);

          // ---- まず移動を試す（待機禁止なので、移動できないときは必ず捜索にフォールバック） ----
          if (preferMove) {
            const target = bestCellByHeat(heat);
            const occupied = new Set(prev.helicopters.map(keyNode));
            occupied.delete(keyNode(heliNode));

            const to = bestMoveNodeTowardAvoidOccupied(heliNode, target, occupied);

            // 移動できたか（隣接かつ別マス）
            const canMove =
              (to.r !== heliNode.r || to.c !== heliNode.c) &&
              neighborsNode(heliNode).some((x) => keyNode(x) === keyNode(to)) &&
              !occupied.has(keyNode(to));

            if (canMove) {
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
            // 移動できないなら捜索へ（待機なし）
          }

          // ---- 捜索 ----
          const target = bestSearchTarget(heliNode, heat, prev.searched);
          const searched = { ...prev.searched, [keyCell(target)]: true };

          // ✅ 捜索マーク（直近3つ）を保存（犯人側に見せる）
          const newMark: SearchMark = { turn: prev.turn, target, heliIndex };
          const lastPoliceSearches = [...prev.lastPoliceSearches, newMark].slice(-3);

          const cp = prev.criminalPos;
          if (cp && target.r === cp.r && target.c === cp.c) {
            aiRunningRef.current = false;
            return {
              ...prev,
              phase: "END",
              winner: "POLICE",
              selectedHeli: heliIndex,
              actionsLeft: 0,
              policeAiThinking: false,
              searched,
              lastPoliceSearches,
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
            lastPoliceSearches,
          };
        });

        if (i === ACTIONS_PER_TURN - 1) {
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
          }, 550);
          aiTimersRef.current.push(t2);
        }
      }, 550 + i * stepDelay);

      aiTimersRef.current.push(t);
    }
  }

  useEffect(() => {
    if (state.phase !== "POLICE_AI_TURN") return;
    if (!state.criminalPos) return;
    if (state.winner) return;
    if (state.mode === "PASS_PLAY") return;
    clearAiTimers();
    runPoliceAiTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.criminalPos, state.winner, state.mode]);

  const visitedSet = useMemo(() => new Set(Object.keys(state.visits)), [state.visits]);

  function canTapCell(c: Cell): boolean {
    if (state.mode === "PASS_PLAY") {
      if (state.handoff.show) return false;

      if (state.viewer === "CRIMINAL") {
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

      if (state.viewer === "POLICE") {
        if (state.phase === "POLICE_TURN" && policeSearchMode && state.selectedHeli != null) {
          const node = state.helicopters[state.selectedHeli];
          const cand = surroundingCells(node);
          return cand.some((x) => x.r === c.r && x.c === c.c);
        }
        return false;
      }
    }

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

    if (state.mode === "PASS_PLAY") {
      if (state.viewer === "CRIMINAL") {
        if (state.phase === "CRIMINAL_HIDE") criminalChooseStart(c);
        else if (state.phase === "CRIMINAL_MOVE") criminalMoveTo(c);
      } else {
        if (state.phase === "POLICE_TURN" && policeSearchMode) searchCellPlayer(c);
      }
      return;
    }

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
      if (state.mode === "PASS_PLAY" && state.viewer !== "POLICE") return;

      const idx = state.helicopters.findIndex((h) => keyNode(h) === keyNode(n));
      if (idx >= 0) {
        selectHeli(idx);
        return;
      }

      if (policeSearchMode) return;

      if (state.selectedHeli == null) return;
      moveHeliPlayer(n);
    }
  }

  function cellStyle(c: Cell): React.CSSProperties {
    const k = keyCell(c);
    const isRevealed = !!state.revealed[k];
    const turns = state.visits[k] ?? [];
    const first = turns.length ? Math.min(...turns) : null;

    const base: React.CSSProperties = {
      border: "1px solid rgba(15,23,42,0.25)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      userSelect: "none",
      background: "linear-gradient(180deg, #2563eb, #1d4ed8)",
      cursor: "default",
      position: "relative",
      boxSizing: "border-box",
      borderRadius: 10,
      boxShadow: "0 6px 10px rgba(0,0,0,0.18)",
    };

    

    if (isRevealed && first != null) {
      base.background = traceColor(first);
      base.opacity = 1;
      base.outline = "2px solid rgba(0,0,0,0.12)";
    }

    const isCriminalMovePhase =
      ((state.mode === "PASS_PLAY" && state.viewer === "CRIMINAL") || (state.mode === "SINGLE" && state.role === "CRIMINAL")) &&
      state.phase === "CRIMINAL_MOVE" &&
      state.criminalPos != null;

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

    const isCriminalHide =
      ((state.mode === "PASS_PLAY" && state.viewer === "CRIMINAL") || (state.mode === "SINGLE" && state.role === "CRIMINAL")) &&
      state.phase === "CRIMINAL_HIDE" &&
      state.criminalPos == null;

    if (isCriminalHide) {
      base.outline = "2px solid rgba(255,255,255,0.35)";
      base.cursor = "pointer";
    }

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

  const winnerText =
    state.winner === "POLICE" ? "🚓 警察の勝ち！" : state.winner === "CRIMINAL" ? "🚗 犯人の勝ち！" : "";
  const winnerSub = state.winner === "POLICE" ? "犯人を見つけました" : state.winner === "CRIMINAL" ? "逃げ切りました" : "";

  // 盤面サイズ（aspectRatioを使わず iOS で安定させる）
  const boardSize = "min(92vw, 640px)";

  const shouldShowCarNow = (cell: Cell) => {
    if (!state.criminalPos) return false;
    const same = state.criminalPos.r === cell.r && state.criminalPos.c === cell.c;
    if (!same) return false;

    if (state.phase === "END") return true;

    if (state.mode === "PASS_PLAY") {
      return state.viewer === "CRIMINAL";
    }
    if (state.role === "CRIMINAL") return true;
    return false;
  };

  // ✅ 捜索マークを表示する条件：ソロ犯人の「犯人手番（CRIMINAL_MOVE）」中に、同ターンの3つ
  const showPoliceSearchMarks = state.mode === "SINGLE" && state.role === "CRIMINAL" && state.phase === "CRIMINAL_MOVE";

  // タイトル画面用のスタイル
  const titleWrapStyle: React.CSSProperties = {
    borderRadius: 18,
    padding: 18,
    background: "linear-gradient(135deg, rgba(17,24,39,0.95), rgba(30,41,59,0.92))",
    color: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.10)",
  };

  const titleButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    height: 58,
    lineHeight: "58px",
    borderRadius: 16,
    fontSize: 16,
    fontWeight: 950,
    background: "rgba(255,255,255,0.10)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.20)",
    backdropFilter: "blur(6px)",
  };

  return (
    <div
      style={{
        padding: 12,
        // ✅ iPad以上では横幅を広げて余白を減らす
        maxWidth: "min(1100px, 96vw)",
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        overflowX: "hidden",
        width: "100%",
      }}
    >
      {/* ===== タイトル画面：Turn/Resetは出さない ===== */}
      {state.phase === "ROLE_SELECT" ? (
        <header style={titleWrapStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ fontSize: 34, fontWeight: 1000, letterSpacing: 0.6 }}>シティチェイス</div>
              <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.78)", lineHeight: 1.4 }}>
                街中を逃げ回る犯人を追跡！鬼ごっこ×かくれんぼ！！
              </div>
            </div>
            <div style={{ fontSize: 34, opacity: 0.9 }}>🚁🔎🚗</div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => chooseRoleSingle("CRIMINAL")} style={{ ...titleButtonStyle, flex: 1, minWidth: 220 }}>
                ソロ：犯人（警察AI）
              </button>
              <button
                onClick={() => chooseRoleSingle("POLICE")}
                style={{
                  ...titleButtonStyle,
                  flex: 1,
                  minWidth: 220,
                  background: "linear-gradient(135deg, rgba(14,165,233,0.92), rgba(59,130,246,0.92))",
                  border: "1px solid rgba(255,255,255,0.18)",
                }}
              >
                ソロ：警察（犯人AI）
              </button>
            </div>

            <button
              onClick={choosePassPlay}
              style={{
                ...titleButtonStyle,
                background: "linear-gradient(135deg, rgba(34,197,94,0.92), rgba(16,185,129,0.92))",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            >
              友達と対戦（同じ端末で交代）
            </button>
          </div>
        </header>
      ) : (
        <header
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
            background: "#fff",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
          }}
        >
          {state.phase === "END" && state.winner && (
            <div
              style={{
                marginBottom: 10,
                borderRadius: 14,
                padding: "12px 14px",
                background: state.winner === "POLICE" ? "#dcfce7" : "#fee2e2",
                border: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 900 }}>{winnerText}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{winnerSub}</div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
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
            <button
              onClick={reset}
              style={{
                ...baseButtonStyle,
                height: 38,
                lineHeight: "38px",
                flex: 1,
                fontSize: 14,
                fontWeight: 800,
              }}
            >
              リセット
            </button>
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: "#374151",
              lineHeight: 1.4,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              minHeight: 44,
            }}
          >
            {state.phase === "POLICE_SETUP" && (state.mode === "PASS_PLAY" ? "友達対戦：警察がヘリを3機配置（交差点タップ）。" : "警察：ヘリを3機配置してください（交差点タップ）。")}
            {state.phase === "POLICE_TURN" &&
              (policeSearchMode ? "警察：捜索モード（周囲4ビルのどれか1つをタップ）" : "警察：移動モード（隣接交差点へ移動）")}
            {state.phase === "CRIMINAL_AI_MOVING" && "犯人AIが移動中…"}
            {state.phase === "CRIMINAL_HIDE" && "犯人：最初に隠れるビルをタップして決めてください。"}
            {state.phase === "POLICE_AI_TURN" && (state.policeAiThinking ? "警察AIが行動中（推理＆揺さぶり）…" : "警察AIのターン")}
            {state.phase === "CRIMINAL_MOVE" && "犯人：移動候補（隣接かつ未訪問）だけ明るく表示（再訪不可）。"}
            {state.phase === "END" && (state.winner === "CRIMINAL" ? "犯人の勝ち" : "警察の勝ち") + "：白線が犯人ルートです（S=開始 / E=終了）。"}
          </div>
        </header>
      )}

      <main
        style={{
          display: "grid",
          gap: 12,
          marginTop: 12,
          // ✅ iPad以上で2カラム、スマホは1カラム
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          alignItems: "start",
        }}
      >

        <section>
          <div ref={boardRef} style={{ position: "relative", width: boardSize, height: boardSize, margin: "0 auto", flex: "0 0 auto" }}>

            <div style={{ position: "absolute", inset: 0, borderRadius: 16, background: "#94a3b8" }} />

            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                gridTemplateColumns: `repeat(${GRID}, 1fr)`,
                gridTemplateRows: `repeat(${GRID}, 1fr)`,
                gap: ROAD_GAP,
                border: "2px solid #0f172a",
                borderRadius: 16,
                overflow: "hidden",
                background: "transparent",
              }}
            >
              {allCells.map((c) => {
                const k = keyCell(c);
                const style = cellStyle(c);
                const tappable = canTapCell(c);

                const isTrace = !!state.revealed[k];
                const showCar = shouldShowCarNow(c);

                // ✅ 捜索マーク：ソロ犯人の犯人手番中に、同ターンの3つを表示
                const mark = showPoliceSearchMarks
                  ? state.lastPoliceSearches.find((m) => m.turn === state.turn && m.target.r === c.r && m.target.c === c.c)
                  : undefined;

                return (
                  <div key={k} style={style} onClick={() => (tappable ? onCellTap(c) : undefined)}>
                    {showCar ? <span style={{ fontSize: 22 }}>🚗</span> : null}

                    {isTrace ? (
                      <span
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 34,
                          fontWeight: 1000 as any,
                          color: "rgba(255,255,255,0.95)",
                          textShadow: "0 3px 10px rgba(0,0,0,0.55)",
                          pointerEvents: "none",
                        }}
                        aria-label="trace"
                      >
                        !
                      </span>
                    ) : null}

                    {mark ? (
                      <span
                        style={{
                          position: "absolute",
                          right: 6,
                          bottom: 6,
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(0,0,0,0.35)",
                          border: `2px solid ${getHeliColor(mark.heliIndex)}`,
                          boxShadow: "0 6px 14px rgba(0,0,0,0.22)",
                          fontSize: 12,
                          pointerEvents: "none",
                        }}
                        title="警察の直前捜索"
                      >
                        🔎
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {state.phase === "END" && routePoints.length > 0 && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, borderRadius: 16, pointerEvents: "none" }}>
                <polyline points={polylinePoints} fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
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

            {allNodes.map((n) => {
              const k = keyNode(n);
              const placedIndex = state.helicopters.findIndex((h) => keyNode(h) === k);
              const placed = placedIndex >= 0;

              const isSelected = state.selectedHeli != null && placedIndex === state.selectedHeli;
              const acted = placedIndex >= 0 ? state.heliActed[placedIndex] : false;

              // fallback（boardPxがまだ0の時用）
              const leftPct = ((n.c + 1) / GRID) * 100;
              const topPct = ((n.r + 1) / GRID) * 100;

              // gap込みのpx計算：交差点（道路の中央）
              const totalGap = (GRID - 1) * ROAD_GAP;
              const cellPx = boardPx > 0 ? (boardPx - totalGap) / GRID : 0;

              const leftPx = boardPx > 0
                ? (n.c + 1) * cellPx + n.c * ROAD_GAP + ROAD_GAP / 2
                : 0;

              const topPx = boardPx > 0
                ? (n.r + 1) * cellPx + n.r * ROAD_GAP + ROAD_GAP / 2
                : 0;


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
              const clickable = (state.phase === "POLICE_SETUP" || state.phase === "POLICE_TURN") && !(state.mode === "PASS_PLAY" && state.viewer !== "POLICE");

              return (
                <button
                  key={k}
                  onClick={() => (clickable ? onNodeTap(n) : undefined)}
                  disabled={!clickable || state.criminalMoving}
                  style={{
                    position: "absolute",
                    left: boardPx > 0 ? `${leftPx}px` : `${leftPct}%`,
                    top:  boardPx > 0 ? `${topPx}px`  : `${topPct}%`,
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
                    appearance: "none",
                    WebkitAppearance: "none",
                    outline: "none",
                  }}
                >
                  {placed ? "🚁" : "·"}
                </button>
              );
            })}

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
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{state.phase === "POLICE_AI_TURN" ? "警察AIが行動中…" : "犯人AIが移動中…"}</div>
                  <div style={{ fontSize: 26, marginTop: 10 }}>{state.phase === "POLICE_AI_TURN" ? "🚁🔎" : "🚗💨"}</div>
                </div>
              </div>
            )}

            {state.handoff.show && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  background: "rgba(0,0,0,0.62)",
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
                    borderRadius: 16,
                    padding: "16px 16px",
                    border: "1px solid rgba(255,255,255,0.18)",
                    width: "min(380px, 92%)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{state.handoff.to === "POLICE" ? "🚓 警察の番" : "🚗 犯人の番"}</div>
                  <div style={{ fontSize: 13, marginTop: 10, opacity: 0.95, lineHeight: 1.45 }}>{state.handoff.message}</div>
                  <button
                    onClick={acceptHandoff}
                    style={{
                      ...baseButtonStyle,
                      width: "100%",
                      marginTop: 12,
                      background: "#fff",
                      color: "#111827",
                    }}
                  >
                    準備OK（見ている人だけ押す）
                  </button>
                </div>
              </div>
            )}
          </div>

          {state.phase === "POLICE_SETUP" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => setState((s) => ({ ...s, helicopters: [], selectedHeli: null }))}
                style={{ ...baseButtonStyle, flex: 1, height: 44, lineHeight: "44px", fontSize: 14, fontWeight: 800 }}
              >
                配置をやり直す
              </button>
              <button
                disabled={state.helicopters.length !== 3}
                onClick={startFromSetup}
                style={{
                  ...baseButtonStyle,
                  flex: 1,
                  height: 44,
                  lineHeight: "44px",
                  fontSize: 14,
                  fontWeight: 900,
                  background: state.helicopters.length === 3 ? "#111827" : "#e5e7eb",
                  color: state.helicopters.length === 3 ? "#fff" : "#6b7280",
                  cursor: state.helicopters.length === 3 ? "pointer" : "not-allowed",
                }}
              >
                この配置で開始
              </button>
            </div>
          )}

          {state.phase === "POLICE_TURN" && (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={!currentHeliCanAct()}
                  onClick={setPoliceModeSearch}
                  style={{
                    ...baseButtonStyle,
                    flex: 1,
                    background: policeSearchMode ? "#111827" : "#ffffff",
                    color: policeSearchMode ? "#ffffff" : "#111827",
                    cursor: currentHeliCanAct() ? "pointer" : "not-allowed",
                    opacity: currentHeliCanAct() ? 1 : 0.55,
                  }}
                >
                  捜索する
                </button>

                <button
                  onClick={setPoliceModeMove}
                  style={{
                    ...baseButtonStyle,
                    flex: 1,
                    background: !policeSearchMode ? "#111827" : "#ffffff",
                    color: !policeSearchMode ? "#ffffff" : "#111827",
                  }}
                >
                  移動する
                </button>
              </div>

              {policeSearchMode ? (
                <div style={{ fontSize: 12, color: "#666" }}>周囲4ビルのどれか1つをタップして捜索してください。</div>
              ) : (
                <div style={{ fontSize: 12, color: "#666" }}>移動したい交差点をタップしてください（隣接のみ / 同じ場所に停泊不可）。</div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
