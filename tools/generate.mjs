// Generates 20 daily game sets (60 maps: 20×L1, 20×L2, 20×L3) for Gardener's Gambit.
// L1: 1 fox 900ms 2 veggies, L2: 2 foxes 750ms 3 veggies, L3: 3 foxes 650ms 5 veggies.
// Each map validated solvable before being kept. Writes src/client/levels.json.
//
// Usage: node tools/generate.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const NR = 23, NC = 23;
const GARDENER_MS = 150;
const DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIRS4 = [[-1,0],[1,0],[0,-1],[0,1]];
const MOVES = [[-1,0,'U'],[1,0,'D'],[0,-1,'L'],[0,1,'R'],[0,0,'.']];

// ── Inline solver (NR/NC fixed to 23) ────────────────────────────────────────

const inb = (r, c) => r >= 0 && r < NR && c >= 0 && c < NC;

function parse(map) {
  const grid = map.map(row => row.slice());
  let gardener = null;
  const foxes = [];
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    const t = grid[r][c];
    if (t === 3) { gardener = [r, c]; grid[r][c] = 1; }
    else if (t === 4) { foxes.push([r, c]); grid[r][c] = 1; }
    else if (t === 5 || t === 6) { grid[r][c] = 1; }
  }
  return { grid, gardener, foxes };
}

function cloneState(s) {
  return { grid: s.grid.map(row => row.slice()), gardener: s.gardener.slice(), foxes: s.foxes.map(f => f.slice()), foxAccum: s.foxAccum };
}

function stateKey(s, foxSpeed) {
  let bits = 0, nb = 0, g = '';
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
    bits = (bits << 1) | (s.grid[r][c] === 2 ? 1 : 0);
    if (++nb === 15) { g += String.fromCharCode(bits); bits = 0; nb = 0; }
  }
  if (nb) g += String.fromCharCode(bits);
  const fs = s.foxes.map(f => f[0] * NC + f[1]).sort((a, b) => a - b).join(',');
  const phase = Math.floor(s.foxAccum / GARDENER_MS) % Math.max(1, Math.ceil(foxSpeed / GARDENER_MS));
  return `${s.gardener[0] * NC + s.gardener[1]}|${fs}|${phase}|${g}`;
}

function pushChain(s, sr, sc, dr, dc) {
  let r = sr, c = sc;
  const chain = [];
  while (inb(r, c) && s.grid[r][c] === 2) { chain.push([r, c]); r += dr; c += dc; }
  if (!inb(r, c) || s.grid[r][c] === 0 || s.grid[r][c] === 7) return false;
  if (s.foxes.some(f => f[0] === r && f[1] === c)) return false;
  for (let i = chain.length - 1; i >= 0; i--) {
    s.grid[chain[i][0] + dr][chain[i][1] + dc] = 2;
    s.grid[chain[i][0]][chain[i][1]] = 1;
  }
  return true;
}

function gardenerMove(s, dr, dc) {
  if (dr === 0 && dc === 0) return true;
  const nr = s.gardener[0] + dr, nc = s.gardener[1] + dc;
  if (!inb(nr, nc)) return false;
  const t = s.grid[nr][nc];
  if (t === 0 || t === 7) return false;
  if (t === 2 && !pushChain(s, nr, nc, dr, dc)) return false;
  s.gardener[0] = nr; s.gardener[1] = nc;
  if (s.foxes.some(f => f[0] === nr && f[1] === nc)) s.dead = true;
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
      if (s.foxes.some(f => f !== fox && f[0] === nr && f[1] === nc)) continue;
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
  let best = null, bestDist = Infinity;
  for (const [dr, dc] of DIRS8) {
    const nr = fox[0] + dr, nc = fox[1] + dc;
    if (!inb(nr, nc) || s.grid[nr][nc] === 0 || s.grid[nr][nc] === 2 || s.grid[nr][nc] === 7) continue;
    if (s.foxes.some(f => f !== fox && f[0] === nr && f[1] === nc)) continue;
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
  s.foxes = s.foxes.filter(fox => {
    const trapped = DIRS4.every(([dr, dc]) => {
      const nr = fox[0] + dr, nc = fox[1] + dc;
      return !inb(nr, nc) || s.grid[nr][nc] === 0 || s.grid[nr][nc] === 2 || s.grid[nr][nc] === 7;
    });
    return !trapped;
  });
}

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

function solve(map, foxSpeed, nodeCap = 1_000_000, timeCapMs = 20_000) {
  const start = parse(map);
  const init = { grid: start.grid, gardener: start.gardener, foxes: start.foxes, foxAccum: 0, dead: false };
  const heap = [];
  const pushH = node => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].h <= heap[i].h) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const popH = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2*i+1, r = 2*i+2; let m = i; if (l < heap.length && heap[l].h < heap[m].h) m = l; if (r < heap.length && heap[r].h < heap[m].h) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  const seen = new Set();
  pushH({ h: heuristic(init), state: init, parent: null, action: null });
  seen.add(stateKey(init, foxSpeed));
  let nodes = 0;
  const t0 = Date.now();
  while (heap.length) {
    if (nodes >= nodeCap) return 'UNKNOWN';
    if ((nodes & 1023) === 0 && Date.now() - t0 > timeCapMs) return 'UNKNOWN';
    const cur = popH();
    nodes++;
    for (const [dr, dc] of MOVES) {
      const ns = cloneState(cur.state);
      ns.dead = false;
      if (!gardenerMove(ns, dr, dc)) continue;
      if (ns.dead) continue;
      checkTraps(ns);
      if (ns.foxes.length === 0) return 'SOLVABLE';
      ns.foxAccum += GARDENER_MS;
      if (ns.foxAccum >= foxSpeed) {
        ns.foxAccum -= foxSpeed;
        moveFoxes(ns);
        if (ns.dead) continue;
        if (ns.foxes.length === 0) return 'SOLVABLE';
      }
      const k = stateKey(ns, foxSpeed);
      if (seen.has(k)) continue;
      seen.add(k);
      pushH({ h: heuristic(ns), state: ns, parent: cur, action: null });
    }
  }
  return 'UNKNOWN';
}

// ── Map templates ─────────────────────────────────────────────────────────────

const SOIL_CELLS = [];
for (let r = 1; r <= 21; r++) for (let c = 1; c <= 21; c++) {
  if (r <= 3 || r >= 19 || c <= 3 || c >= 19) SOIL_CELLS.push([r, c]);
}

const CENTER_CELLS = [];
for (let r = 4; r <= 18; r++) for (let c = 4; c <= 18; c++) {
  if (r !== 11 || c !== 11) CENTER_CELLS.push([r, c]);
}

function buildBaseGrid() {
  return Array.from({ length: NR }, (_, r) =>
    Array.from({ length: NC }, (_, c) => {
      if (r === 0 || r === NR - 1 || c === 0 || c === NC - 1) return 0;
      if (r <= 3 || r >= 19 || c <= 3 || c >= 19) return 1;
      return 2;
    })
  );
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateMap(foxCount, veggieCount, stoneCount, rng) {
  const grid = buildBaseGrid();
  grid[11][11] = 3;

  // Spread foxes: for multi-fox maps, try to place them on different sides
  let soilPool = shuffle(SOIL_CELLS, rng);
  if (foxCount > 1) {
    // Bucket by region: top, bottom, left, right — pick one from each, dedup via key set
    const regions = [
      soilPool.filter(([r]) => r <= 3),
      soilPool.filter(([r]) => r >= 19),
      soilPool.filter(([, c]) => c <= 3),
      soilPool.filter(([, c]) => c >= 19),
    ];
    const used = new Set();
    const foxPositions = [];
    for (let i = 0; i < foxCount; i++) {
      const reg = regions[i % 4];
      let pos = null;
      while (reg.length) {
        const candidate = reg.shift();
        const k = candidate[0] * 100 + candidate[1];
        if (!used.has(k)) { used.add(k); pos = candidate; break; }
      }
      if (!pos) {
        pos = soilPool.find(p => !used.has(p[0] * 100 + p[1]));
        if (pos) used.add(pos[0] * 100 + pos[1]);
      }
      if (pos) foxPositions.push(pos);
    }
    for (const [r, c] of foxPositions) grid[r][c] = 4;
  } else {
    grid[soilPool[0][0]][soilPool[0][1]] = 4;
  }

  // Veggies in center (avoid gardener + occupied cells)
  const avail = CENTER_CELLS.filter(([r, c]) => grid[r][c] === 2);
  const shuffledAvail = shuffle(avail, rng);
  for (let i = 0; i < veggieCount && i < shuffledAvail.length; i++) {
    const [r, c] = shuffledAvail[i];
    grid[r][c] = i % 2 === 0 ? 5 : 6; // alternate pumpkin/corn
  }

  // Stones: place away from center (not within 3 cells of gardener)
  const stonePool = CENTER_CELLS.filter(([r, c]) => {
    if (grid[r][c] !== 2) return false;
    return Math.abs(r - 11) > 3 || Math.abs(c - 11) > 3;
  });
  const shuffledStones = shuffle(stonePool, rng);
  for (let i = 0; i < stoneCount && i < shuffledStones.length; i++) {
    grid[shuffledStones[i][0]][shuffledStones[i][1]] = 7;
  }

  return grid;
}

// ── Generate ─────────────────────────────────────────────────────────────────

const CONFIGS = [
  { foxCount: 1, veggieCount: 2, foxSpeed: 900, stoneRange: [0, 2] },
  { foxCount: 2, veggieCount: 3, foxSpeed: 750, stoneRange: [0, 3] },
  { foxCount: 3, veggieCount: 5, foxSpeed: 650, stoneRange: [1, 4] },
];
const TARGET = 20;

// allMaps[gameIdx * 3 + levelIdx]
const allMaps = [];

for (let gameIdx = 0; gameIdx < TARGET; gameIdx++) {
  for (let li = 0; li < CONFIGS.length; li++) {
    const { foxCount, veggieCount, foxSpeed, stoneRange } = CONFIGS[li];
    let attempt = 0;
    while (true) {
      attempt++;
      const seed = gameIdx * 10000 + li * 1000 + attempt;
      const rng = mulberry32(seed);
      const stoneCount = stoneRange[0] + Math.floor(rng() * (stoneRange[1] - stoneRange[0] + 1));
      const map = generateMap(foxCount, veggieCount, stoneCount, rng);
      const result = solve(map, foxSpeed);
      if (result === 'SOLVABLE') {
        allMaps.push(map);
        process.stdout.write(`  Game ${String(gameIdx + 1).padStart(2)} L${li + 1}: OK (attempt ${attempt})\n`);
        break;
      }
      if (attempt % 50 === 0) process.stdout.write(`  Game ${gameIdx + 1} L${li + 1}: still searching (attempt ${attempt})...\n`);
    }
  }
}

const output = { maps: allMaps, foxSpeeds: [900, 750, 650] };
writeFileSync(join(here, '../src/client/levels.json'), JSON.stringify(output));
process.stdout.write(`\nDone. ${allMaps.length} maps written to src/client/levels.json\n`);
