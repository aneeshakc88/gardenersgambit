// Solvability checker for Gardener's Gambit.
// Mirrors src/client/scenes/Game.ts rules exactly and searches for a winning
// gardener move sequence (traps all foxes). Single source of maps: src/client/levels.json.
//
// Usage:  node tools/solve.mjs            (all levels)
//         node tools/solve.mjs 0          (just level index 0)
//         node tools/solve.mjs 0 3000000  (level 0, node cap 3,000,000)
//
// Output: SOLVABLE + move list, or UNKNOWN (no win found within caps — NOT a
// proof of unsolvable; playtest to be sure).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const levels = JSON.parse(readFileSync(join(here, '../src/client/levels.json'), 'utf8'));

let NR = 14, NC = 16; // set per-map from dimensions before each solve
const GARDENER_MS = 150; // input cooldown
const DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIRS4 = [[-1,0],[1,0],[0,-1],[0,1]];
const MOVES = [[-1,0,'U'],[1,0,'D'],[0,-1,'L'],[0,1,'R'],[0,0,'.']]; // last = wait

const inb = (r, c) => r >= 0 && r < NR && c >= 0 && c < NC;

function parse(map) {
  const grid = map.map((row) => row.slice());
  let gardener = null;
  const foxes = [];
  for (let r = 0; r < NR; r++) {
    for (let c = 0; c < NC; c++) {
      const t = grid[r][c];
      if (t === 3) { gardener = [r, c]; grid[r][c] = 1; }
      else if (t === 4) { foxes.push([r, c]); grid[r][c] = 1; }
      else if (t === 5 || t === 6) { grid[r][c] = 1; } // veggies = passable, irrelevant to trapping
    }
  }
  return { grid, gardener, foxes };
}

// Deep-ish clone of mutable state
function cloneState(s) {
  return {
    grid: s.grid.map((row) => row.slice()),
    gardener: s.gardener.slice(),
    foxes: s.foxes.map((f) => f.slice()),
    foxAccum: s.foxAccum,
  };
}

function key(s, foxSpeed) {
  // hedge layout packed 15 bits/char + gardener + sorted foxes + fox phase bucket
  let bits = 0, nb = 0, g = '';
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    bits = (bits << 1) | (s.grid[r][c] === 2 ? 1 : 0);
    if (++nb === 15) { g += String.fromCharCode(bits); bits = 0; nb = 0; }
  }
  if (nb) g += String.fromCharCode(bits);
  const fs = s.foxes.map((f) => f[0] * NC + f[1]).sort((a, b) => a - b).join(',');
  const phase = Math.floor((s.foxAccum / GARDENER_MS)) % Math.max(1, Math.ceil(foxSpeed / GARDENER_MS));
  return `${s.gardener[0] * NC + s.gardener[1]}|${fs}|${phase}|${g}`;
}

// Gardener attempts a move. Returns true if it changed state (or waited), false if blocked.
// Mutates s. Sets s.dead=true if gardener walks onto a fox.
function gardenerMove(s, dr, dc) {
  if (dr === 0 && dc === 0) return true; // wait
  const nr = s.gardener[0] + dr, nc = s.gardener[1] + dc;
  if (!inb(nr, nc)) return false;
  const t = s.grid[nr][nc];
  if (t === 0 || t === 7) return false; // fence / rock: immovable walls
  if (t === 2 && !pushChain(s, nr, nc, dr, dc)) return false;
  s.gardener[0] = nr; s.gardener[1] = nc;
  if (s.foxes.some((f) => f[0] === nr && f[1] === nc)) s.dead = true;
  return true;
}

function pushChain(s, sr, sc, dr, dc) {
  let r = sr, c = sc;
  const chain = [];
  while (inb(r, c) && s.grid[r][c] === 2) { chain.push([r, c]); r += dr; c += dc; }
  if (!inb(r, c)) return false;
  if (s.grid[r][c] === 0 || s.grid[r][c] === 7) return false; // can't push into fence/rock
  if (s.foxes.some((f) => f[0] === r && f[1] === c)) return false;
  for (let i = chain.length - 1; i >= 0; i--) {
    const [hr, hc] = chain[i];
    s.grid[hr + dr][hc + dc] = 2;
    s.grid[hr][hc] = 1;
  }
  return true;
}

function foxStep(s, fox) {
  const [tr, tc] = s.gardener;
  if (fox[0] === tr && fox[1] === tc) return null;
  const visited = Array.from({ length: NR }, () => new Array(NC).fill(false));
  const parent = Array.from({ length: NR }, () => new Array(NC).fill(null));
  visited[fox[0]][fox[1]] = true;
  const q = [[fox[0], fox[1]]];
  let found = false;
  while (q.length) {
    const [cr, cc] = q.shift();
    for (const [dr, dc] of DIRS8) {
      const nr = cr + dr, nc = cc + dc;
      if (!inb(nr, nc) || visited[nr][nc]) continue;
      if (s.grid[nr][nc] === 0 || s.grid[nr][nc] === 2 || s.grid[nr][nc] === 7) continue;
      if (s.foxes.some((f) => f !== fox && f[0] === nr && f[1] === nc)) continue;
      visited[nr][nc] = true;
      parent[nr][nc] = [cr, cc];
      if (nr === tr && nc === tc) { found = true; break; }
      q.push([nr, nc]);
    }
    if (found) break;
  }
  if (visited[tr][tc]) {
    let pos = [tr, tc];
    while (parent[pos[0]][pos[1]] && (parent[pos[0]][pos[1]][0] !== fox[0] || parent[pos[0]][pos[1]][1] !== fox[1])) {
      pos = parent[pos[0]][pos[1]];
    }
    return pos;
  }
  // greedy fallback
  let best = null, bestDist = Infinity;
  for (const [dr, dc] of DIRS8) {
    const nr = fox[0] + dr, nc = fox[1] + dc;
    if (!inb(nr, nc)) continue;
    if (s.grid[nr][nc] === 0 || s.grid[nr][nc] === 2 || s.grid[nr][nc] === 7) continue;
    if (s.foxes.some((f) => f !== fox && f[0] === nr && f[1] === nc)) continue;
    const d = Math.abs(nr - tr) + Math.abs(nc - tc);
    if (d < bestDist) { bestDist = d; best = [nr, nc]; }
  }
  return best;
}

function moveFoxes(s) {
  for (const fox of s.foxes) {
    const next = foxStep(s, fox);
    if (!next) continue;
    fox[0] = next[0]; fox[1] = next[1];
    if (fox[0] === s.gardener[0] && fox[1] === s.gardener[1]) { s.dead = true; return; }
  }
  checkTraps(s);
}

function checkTraps(s) {
  s.foxes = s.foxes.filter((fox) => {
    const trapped = DIRS4.every(([dr, dc]) => {
      const nr = fox[0] + dr, nc = fox[1] + dc;
      if (!inb(nr, nc)) return true;
      return s.grid[nr][nc] === 0 || s.grid[nr][nc] === 2 || s.grid[nr][nc] === 7;
    });
    return !trapped; // keep if NOT trapped
  });
}

// Heuristic: lower = closer to winning. Dominated by fox count, then by the total
// open area the foxes can still roam (8-dir flood over soil) — this shrinks as the
// gardener walls off the ring, giving best-first a real gradient instead of a plateau.
// Then per-fox orthogonal escapes, then gardener distance to nearest fox (to engage).
function heuristic(s) {
  if (s.foxes.length === 0) return 0;
  const seen = Array.from({ length: NR }, () => new Array(NC).fill(false));
  const stack = [];
  for (const f of s.foxes) if (!seen[f[0]][f[1]]) { seen[f[0]][f[1]] = true; stack.push([f[0], f[1]]); }
  let region = 0;
  while (stack.length) {
    const [r, c] = stack.pop();
    region++;
    for (const [dr, dc] of DIRS8) {
      const nr = r + dr, nc = c + dc;
      if (!inb(nr, nc) || seen[nr][nc] || s.grid[nr][nc] !== 1) continue;
      seen[nr][nc] = true; stack.push([nr, nc]);
    }
  }
  let escapes = 0, nearest = Infinity;
  for (const fox of s.foxes) {
    for (const [dr, dc] of DIRS4) {
      const nr = fox[0] + dr, nc = fox[1] + dc;
      if (inb(nr, nc) && s.grid[nr][nc] === 1) escapes++;
    }
    const d = Math.abs(fox[0] - s.gardener[0]) + Math.abs(fox[1] - s.gardener[1]);
    if (d < nearest) nearest = d;
  }
  return s.foxes.length * 100000 + region * 50 + escapes * 10 + nearest;
}

function solve(map, foxSpeed, nodeCap, timeCapMs) {
  const start = parse(map);
  const init = { grid: start.grid, gardener: start.gardener, foxes: start.foxes, foxAccum: 0, dead: false };

  // Best-first (greedy) search. Priority by heuristic. Not optimal-path, just finds a win.
  const heap = []; // array of {h, state, path}; simple sorted insert kept small via Map dedup
  const pushHeap = (node) => {
    // binary heap insert
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].h <= heap[i].h) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const popHeap = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2*i+1, r = 2*i+2; let m = i; if (l < heap.length && heap[l].h < heap[m].h) m = l; if (r < heap.length && heap[r].h < heap[m].h) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };

  // path reconstructed via parent pointers (no per-node path copies → far less memory)
  const rebuild = (node, lastLabel) => {
    const out = lastLabel !== undefined ? [lastLabel] : [];
    for (let n = node; n && n.action !== null; n = n.parent) out.push(n.action);
    return out.reverse();
  };

  const seen = new Set();
  pushHeap({ h: heuristic(init), state: init, parent: null, action: null });
  seen.add(key(init, foxSpeed));

  let nodes = 0;
  const t0 = Date.now();
  while (heap.length) {
    if (nodes >= nodeCap) return { result: 'UNKNOWN', reason: `node cap ${nodeCap}`, nodes };
    if ((nodes & 1023) === 0 && Date.now() - t0 > timeCapMs) return { result: 'UNKNOWN', reason: `time cap ${timeCapMs}ms`, nodes };
    const cur = popHeap();
    nodes++;

    for (const [dr, dc, label] of MOVES) {
      const ns = cloneState(cur.state);
      ns.dead = false;
      const changed = gardenerMove(ns, dr, dc);
      if (!changed) continue;            // blocked move, skip
      if (ns.dead) continue;             // walked into fox, dead branch
      checkTraps(ns);                    // game runs checkTraps after a gardener move
      if (ns.foxes.length === 0) return { result: 'SOLVABLE', path: rebuild(cur, label), nodes };

      // advance time; fox moves when accumulator crosses fox speed
      ns.foxAccum += GARDENER_MS;
      if (ns.foxAccum >= foxSpeed) {
        ns.foxAccum -= foxSpeed;
        moveFoxes(ns);
        if (ns.dead) continue;           // gardener caught
        if (ns.foxes.length === 0) return { result: 'SOLVABLE', path: rebuild(cur, label), nodes };
      }

      const k = key(ns, foxSpeed);
      if (seen.has(k)) continue;
      seen.add(k);
      pushHeap({ h: heuristic(ns), state: ns, parent: cur, action: label });
    }
  }
  return { result: 'UNKNOWN', reason: 'search exhausted (no win found)', nodes };
}

// ── run ──────────────────────────────────────────────────────────────────────
const onlyLevel = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
const nodeCap = process.argv[3] !== undefined ? Number(process.argv[3]) : 1_500_000;
const timeCapMs = process.argv[4] !== undefined ? Number(process.argv[4]) : 30_000;

const idxs = onlyLevel !== null ? [onlyLevel] : levels.maps.map((_, i) => i);
for (const i of idxs) {
  const speed = levels.foxSpeeds[i % levels.foxSpeeds.length] ?? 1000;
  NR = levels.maps[i].length;
  NC = levels.maps[i][0].length;
  process.stdout.write(`\nLevel ${i + 1} (${NR}x${NC}, fox speed ${speed}ms, ${parse(levels.maps[i]).foxes.length} foxes)\n`);
  const t0 = Date.now();
  const out = solve(levels.maps[i], speed, nodeCap, timeCapMs);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (out.result === 'SOLVABLE') {
    process.stdout.write(`  ✔ SOLVABLE in ${out.path.length} gardener actions  (${out.nodes} nodes, ${dt}s)\n`);
    process.stdout.write(`    moves: ${out.path.join(' ')}\n`);
  } else {
    process.stdout.write(`  ? UNKNOWN — ${out.reason}  (${out.nodes} nodes, ${dt}s)\n`);
    process.stdout.write(`    Not a proof of unsolvable. Playtest to confirm.\n`);
  }
}
