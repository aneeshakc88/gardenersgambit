import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import { navigateTo } from '@devvit/web/client';
import { GARDENER_SKINS, FOX_SKINS, foxKey, makeSkinTextures, fitSize } from '../skins';
import { GARDENER_UNLOCKS, FOX_UNLOCKS } from '../../shared/api';

// Tile codes: 0 fence, 1 soil, 2 grass, 3 gardener, 4 fox, 5 pumpkin, 6 corn, 7 rock(immovable).
// Objects (>=3) render on a soil base. Fence is the fixed 1-thick border (not user-editable).

type Tool = 'grass' | 'soil' | 'gardener' | 'fox' | 'veggie' | 'rock';

const VEGGIES = [{ name: 'Pumpkin +100', code: 5 }, { name: 'Corn +50', code: 6 }];

const PAD = 8;
const GRID_M = 0;    // edge-to-edge: centering handles alignment
const FENCE_PX = 4;  // thin fence border replaces full fence cells
const BAR_H = 130;   // portrait bottom bar (3 rows: tools | sizes+actions | test+publish)
const RAIL_W = 136;  // landscape left rail (2 cols)
const FENCE = 0x35c7dd, SOIL = 0xcba877, GRASS_BD = 0x63b845, GRASS = 0x3c8e2c, ROCK = 0x8a8d91;
const MIN_WH = 17, MAX_WH = 31, MIN_GRASS = 9; // W/H field shows soil+grass tile count (total = value+2 incl fence ring); min 15 tiles
// grass floor 0.50 (not 0.65): daily 3-thick ring is ~51% and editor default ~58%;
// foxes-outer-ring + reachability carry solvability, so a high density floor isn't needed.
const GRASS_MIN = 0.50, GRASS_MAX = 0.90, MAX_FOX = 3, MIN_GARD_FOX = 3;

export class Editor extends Scene {
  private cols = 19;
  private rows = 19;
  private soilR = 2;
  private soilC = 2;
  private grid: number[][] = [];
  private tool: Tool = 'grass';
  private gardenerSkin = 0;
  private foxSkin = 0;
  private username = '';
  private unlockedGardener: number[] = [0];
  private unlockedFox: number[] = [0];
  private veggieIdx = 0;
  private variantOpen = false;
  private title = '';
  private modalOpen = false;
  private levelVerified = false;
  private inputBlocked = false;

  private cell = 24;
  private ox = 0;
  private oy = 0;

  private gridG!: Phaser.GameObjects.Graphics;
  private entities: Phaser.GameObjects.Image[] = [];
  private uiObjs: Phaser.GameObjects.GameObject[] = [];
  private undoStack: number[][][] = [];
  private redoStack: number[][][] = [];
  private painting = false;
  private baseDepth = 5; // raised while building floating panels so their content sits on top
  private blockRects: Phaser.Geom.Rectangle[] = []; // pointer-exclusion zones (panels/strips)
  private dimInput: Phaser.GameObjects.DOMElement | null = null;

  constructor() { super('Editor'); }

  init(data: { username?: string; unlockedGardener?: number[]; unlockedFox?: number[] }) {
    this.username = data.username ?? '';
    this.unlockedGardener = data.unlockedGardener ?? [0];
    this.unlockedFox = data.unlockedFox ?? [0];
  }

  create() {
    this.cameras.main.setBackgroundColor(0x10261a);
    this.title = '';
    this.makeTextures();
    this.resetDefault();
    this.gridG = this.add.graphics().setDepth(0);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (!this.modalOpen && !this.inputBlocked) this.onPointer(p, true); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (!this.modalOpen && !this.inputBlocked) this.onPointer(p, false); });
    this.input.on('pointerup', () => { if (this.painting) { this.painting = false; this.refreshValidation(); } });

    this.layout();
    this.scale.on('resize', () => this.layout());
    this.events.on('wake', () => {
      this.inputBlocked = true;
      this.time.delayedCall(350, () => { this.inputBlocked = false; });
      if (this.dimInput) { this.dimInput.destroy(); this.dimInput = null; }
      this.layout();
      try {
        const result = localStorage.getItem('gg_verify_result');
        if (result === 'won') {
          localStorage.removeItem('gg_verify_result');
          localStorage.removeItem('gg_verify_intent');
          this.levelVerified = true;
          this.showPublishModal();
        } else {
          localStorage.removeItem('gg_verify_intent');
        }
      } catch { /* ignore */ }
    });
  }

  private get W() { return this.scale.width; }
  private get H() { return this.scale.height; }
  private get portrait() { return this.H >= this.W; }
  private get barH() { return BAR_H; }
  private hasVariants() { return this.isVariant(this.tool); }
  private isVariant(t: Tool) { return t === 'gardener' || t === 'fox' || t === 'veggie'; }
  private foxKey(i: number) { return foxKey(i); }

  // ── board model ───────────────────────────────────────────────────────────
  private resetDefault() {
    this.cols = 19; this.rows = 19; this.soilR = 2; this.soilC = 2;
    this.grid = this.buildTerrain();
    this.grid[Math.floor(this.rows / 2)]![Math.floor(this.cols / 2)] = 3;
    this.undoStack = []; this.redoStack = [];
    this.levelVerified = false;
  }

  private terrainAt(r: number, c: number): number {
    if (r === 0 || c === 0 || r === this.rows - 1 || c === this.cols - 1) return 0;
    if (r < 1 + this.soilR || r >= this.rows - 1 - this.soilR ||
        c < 1 + this.soilC || c >= this.cols - 1 - this.soilC) return 1;
    return 2;
  }
  private buildTerrain(): number[][] {
    const g: number[][] = [];
    for (let r = 0; r < this.rows; r++) { g[r] = []; for (let c = 0; c < this.cols; c++) g[r]![c] = this.terrainAt(r, c); }
    return g;
  }
  private regen() {
    const objs: { r: number; c: number; code: number }[] = [];
    for (let r = 0; r < this.grid.length; r++)
      for (let c = 0; c < (this.grid[r]?.length ?? 0); c++)
        if (this.grid[r]![c]! >= 3) objs.push({ r, c, code: this.grid[r]![c]! });
    this.grid = this.buildTerrain();
    let hasG = false;
    for (const o of objs) if (o.r > 0 && o.r < this.rows - 1 && o.c > 0 && o.c < this.cols - 1) {
      this.grid[o.r]![o.c] = o.code; if (o.code === 3) hasG = true;
    }
    if (!hasG) this.grid[Math.floor(this.rows / 2)]![Math.floor(this.cols / 2)] = 3;
  }
  private grassW() { return this.cols - 2 - 2 * this.soilC; }
  private grassH() { return this.rows - 2 - 2 * this.soilR; }

  private maxSoil(span: number) { return Math.max(1, Math.floor((span - 2 - MIN_GRASS) / 2)); }

  private setDimTo(which: 'W' | 'H' | 'sR' | 'sC', value: number) {
    this.pushUndo();
    if (which === 'W') { this.cols = Phaser.Math.Clamp(value + 2, MIN_WH, MAX_WH); this.soilC = Math.min(this.soilC, this.maxSoil(this.cols)); }
    if (which === 'H') { this.rows = Phaser.Math.Clamp(value + 2, MIN_WH, MAX_WH); this.soilR = Math.min(this.soilR, this.maxSoil(this.rows)); }
    if (which === 'sC') { this.soilC = Phaser.Math.Clamp(value, 1, this.maxSoil(this.cols)); }
    if (which === 'sR') { this.soilR = Phaser.Math.Clamp(value, 1, this.maxSoil(this.rows)); }
    this.regen();
    this.layout();
  }
  private setDim(which: 'W' | 'H' | 'sR' | 'sC', delta: number) {
    const cur = which === 'W' ? this.cols - 2 : which === 'H' ? this.rows - 2 : which === 'sR' ? this.soilR : this.soilC;
    this.setDimTo(which, cur + delta);
  }

  // ── layout ──────────────────────────────────────────────────────────────
  private layout() {
    const M = GRID_M;
    let areaX: number, areaY: number, areaW: number, areaH: number;
    if (this.portrait) {
      areaX = M; areaY = M; areaW = this.W - 2 * M; areaH = this.H - this.barH - 2 * M;
    } else {
      areaX = RAIL_W + M; areaY = M; areaW = this.W - RAIL_W - 2 * M; areaH = this.H - 2 * M;
    }
    const innerCols = this.cols - 2, innerRows = this.rows - 2;
    this.cell = Math.max(8, Math.floor(Math.min(
      (areaW - 2 * FENCE_PX) / innerCols,
      (areaH - 2 * FENCE_PX) / innerRows
    )));
    const fw = innerCols * this.cell + 2 * FENCE_PX, fh = innerRows * this.cell + 2 * FENCE_PX;
    this.ox = areaX + Math.floor((areaW - fw) / 2);
    this.oy = this.portrait ? areaY : areaY + Math.floor((areaH - fh) / 2);
    this.renderGrid();
    this.buildUI();
  }

  // ── grid render ─────────────────────────────────────────────────────────
  private renderGrid() {
    const g = this.gridG; g.clear();
    this.entities.forEach((e) => e.destroy()); this.entities = [];
    const S = this.cell, fx = this.ox, fy = this.oy;
    const innerCols = this.cols - 2, innerRows = this.rows - 2;
    const innerW = innerCols * S, innerH = innerRows * S;
    const totalW = innerW + 2 * FENCE_PX, totalH = innerH + 2 * FENCE_PX;

    // shadow
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(fx - 7, fy - 5, totalW + 14, totalH + 16, 10);

    // Interior cells only (r=1..rows-2, c=1..cols-2)
    for (let r = 1; r < this.rows - 1; r++) {
      for (let c = 1; c < this.cols - 1; c++) {
        const x = fx + FENCE_PX + (c - 1) * S, y = fy + FENCE_PX + (r - 1) * S;
        const code = this.grid[r]![c]!;
        const terrain = code <= 2 ? code : 1;
        if (terrain === 1) {
          g.fillStyle(SOIL); g.fillRect(x, y, S, S);
        } else {
          g.fillStyle(GRASS_BD); g.fillRect(x, y, S, S);            // 1px dark gridline
          g.fillStyle(GRASS); g.fillRect(x + 1, y + 1, S - 2, S - 2);
          // sparse, faint grass tuft on ~30% of cells (quiet board → sprites pop)
          if ((r * 73 + c * 37) % 10 < 3 && S >= 10) {
            const mw = Math.max(1, Math.floor(S * 0.22));
            g.fillStyle(0x5AA03F);
            g.fillRect(x + Math.floor(S * 0.32), y + Math.floor(S * 0.30), mw, 1);
            g.fillRect(x + Math.floor(S * 0.44), y + Math.floor(S * 0.56), mw, 1);
          }
        }
        if (code === 7) {
          g.fillStyle(0x5f6266); g.fillRoundedRect(x + 2, y + 2, S - 4, S - 4, Math.max(2, S / 6));
          g.fillStyle(ROCK); g.fillRoundedRect(x + 3, y + 3, S - 7, S - 7, Math.max(2, S / 6));
        } else if (code >= 3) {
          const key = code === 3 ? `gard_${this.gardenerSkin}` : code === 4 ? this.foxKey(this.foxSkin) : code === 5 ? 'pumpkin' : 'corn';
          // Snoovatar (skin 0) has transparent padding, so give it a slightly bigger box to fill the cell.
          const box = code === 3 && this.gardenerSkin === 0 ? S * 1.3 : S * 1.28;
          const sz = (code === 4 || code === 3) ? fitSize(this, key, box) : { w: S * 0.92, h: S * 0.92 };
          this.entities.push(this.add.image(x + S / 2, y + S / 2, key).setDisplaySize(sz.w, sz.h).setDepth(1));
        }
      }
    }

    // Thin fence border
    g.fillStyle(FENCE);
    g.fillRect(fx, fy, totalW, FENCE_PX);
    g.fillRect(fx, fy + FENCE_PX + innerH, totalW, FENCE_PX);
    g.fillRect(fx, fy + FENCE_PX, FENCE_PX, innerH);
    g.fillRect(fx + FENCE_PX + innerW, fy + FENCE_PX, FENCE_PX, innerH);
    g.lineStyle(3, 0x0a1f12, 0.9); g.strokeRect(fx, fy, totalW, totalH);
  }

  // ── painting ────────────────────────────────────────────────────────────
  private onPointer(p: Phaser.Input.Pointer, down: boolean) {
    for (const z of this.blockRects) if (z.contains(p.x, p.y)) return; // bar / rail / flyout
    const ix = this.ox + FENCE_PX, iy = this.oy + FENCE_PX;
    const innerW = (this.cols - 2) * this.cell, innerH = (this.rows - 2) * this.cell;
    const inGrid = p.x >= ix && p.x < ix + innerW && p.y >= iy && p.y < iy + innerH;
    if (!inGrid) return;
    if (down) { this.painting = true; this.pushUndo(); }
    if (!this.painting) return;
    const c = 1 + Math.floor((p.x - ix) / this.cell), r = 1 + Math.floor((p.y - iy) / this.cell);
    if (r <= 0 || r >= this.rows - 1 || c <= 0 || c >= this.cols - 1) return;
    const code = this.toolCode();
    this.grid[r]![c] = code;
    if (code === 3) for (let rr = 0; rr < this.rows; rr++) for (let cc = 0; cc < this.cols; cc++)
      if (this.grid[rr]![cc] === 3 && !(rr === r && cc === c)) this.grid[rr]![cc] = this.terrainAt(rr, cc);
    this.renderGrid();
  }
  private toolCode(): number {
    switch (this.tool) {
      case 'grass': return 2; case 'soil': return 1; case 'gardener': return 3;
      case 'fox': return 4; case 'veggie': return VEGGIES[this.veggieIdx]!.code; case 'rock': return 7;
    }
  }

  // ── undo / redo / clear ───────────────────────────────────────────────────
  private clone(g: number[][]) { return g.map((row) => row.slice()); }
  private pushUndo() { this.levelVerified = false; this.undoStack.push(this.clone(this.grid)); if (this.undoStack.length > 80) this.undoStack.shift(); this.redoStack = []; }
  private restoreDims(s: number[][]) { this.rows = s.length; this.cols = s[0]!.length; this.soilR = Math.min(this.soilR, this.maxSoil(this.rows)); this.soilC = Math.min(this.soilC, this.maxSoil(this.cols)); }
  private undo() { const s = this.undoStack.pop(); if (!s) return; this.levelVerified = false; this.redoStack.push(this.clone(this.grid)); this.grid = s; this.restoreDims(s); this.layout(); }
  private redo() { const s = this.redoStack.pop(); if (!s) return; this.levelVerified = false; this.undoStack.push(this.clone(this.grid)); this.grid = s; this.restoreDims(s); this.layout(); }
  private clearAll() { this.pushUndo(); this.resetDefault(); this.undoStack.pop(); this.layout(); }

  // ── UI ────────────────────────────────────────────────────────────────────
  private buildUI() {
    this.uiObjs.forEach((o) => o.destroy()); this.uiObjs = [];
    this.blockRects = [];
    this.baseDepth = 5;
    if (this.portrait) this.buildBottomBar(); else this.buildLeftRail();
    this.buildValidationOverlay();
    if (this.variantOpen && this.hasVariants()) { this.baseDepth = 60; this.buildVariantFlyout(); }
    this.baseDepth = 5;
    if (!this.portrait) this.buildMuteBtn();
  }

  private portraitActionList(): [string, () => void][] {
    const muteIcon = localStorage.getItem('gg_mute') === '1' ? '🔇' : '🔊';
    return [
      ['↶', () => this.undo()], ['↷', () => this.redo()],
      ['⟲', () => this.clearAll()],
      [muteIcon, () => {
        const muted = !this.sound.mute;
        this.sound.mute = muted;
        localStorage.setItem('gg_mute', muted ? '1' : '0');
        this.layout();
      }],
    ];
  }

  private buildMuteBtn() {
    const icon = this.add.text(this.W - 8, 8, localStorage.getItem('gg_mute') === '1' ? '🔇' : '🔊', {
      fontSize: '18px',
    }).setOrigin(1, 0).setDepth(100).setInteractive({ useHandCursor: true });
    icon.on('pointerdown', () => {
      const muted = !this.sound.mute;
      this.sound.mute = muted;
      localStorage.setItem('gg_mute', muted ? '1' : '0');
      icon.setText(muted ? '🔇' : '🔊');
    });
    this.uiObjs.push(icon);
    this.blockRects.push(new Phaser.Geom.Rectangle(this.W - 36, 0, 36, 36));
  }

  private refreshValidation() { this.layout(); }

  private headerBtn(x: number, y: number, w: number, h: number, label: string, fill: number, stroke: number, disabled: boolean, onClick: () => void) {
    const g = this.add.graphics().setDepth(this.baseDepth);
    g.fillStyle(disabled ? 0x1a1a1a : fill, 1);
    g.fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(2, disabled ? 0x383838 : stroke, 1);
    g.strokeRoundedRect(x, y, w, h, 8);
    this.uiObjs.push(g);
    if (!disabled) {
      const hit = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0.001)
        .setDepth(this.baseDepth + 1).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', onClick);
      hit.on('pointerover', () => g.setAlpha(0.8));
      hit.on('pointerout', () => g.setAlpha(1));
      this.uiObjs.push(hit);
    }
    this.addText(x + w / 2, y + h / 2, label, 14, disabled ? '#555555' : '#ffffff', 0.5, 0.5);
  }

  // ── validation ─────────────────────────────────────────────────────────────
  private validateMap(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    let gard = 0, grass = 0; const foxes: [number, number][] = []; let gpos: [number, number] | null = null;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const code = this.grid[r]![c]!;
      if (code === 3) { gard++; gpos = [r, c]; }
      else if (code === 4) foxes.push([r, c]);
      else if (code === 2) grass++;
    }
    const interior = (this.cols - 2) * (this.rows - 2);

    if (gard !== 1) errors.push(`Need exactly 1 gardener (have ${gard})`);
    if (foxes.length < 1) errors.push('Place at least 1 fox');
    if (foxes.length > MAX_FOX) errors.push(`Max ${MAX_FOX} foxes (have ${foxes.length})`);

    const need = Math.ceil(GRASS_MIN * interior), maxG = Math.floor(GRASS_MAX * interior);
    if (grass < need) errors.push(`Add ${need - grass} more grass tiles`);
    else if (grass > maxG) errors.push(`Remove ${grass - maxG} grass tiles (too dense)`);

    const centerFox = foxes.filter(([r, c]) => this.terrainAt(r, c) !== 1).length;
    if (centerFox > 0) errors.push(`Move ${centerFox} fox${centerFox > 1 ? 'es' : ''} to the outer soil ring`);

    if (gpos) {
      const close = foxes.filter(([r, c]) => Math.abs(r - gpos![0]) + Math.abs(c - gpos![1]) < MIN_GARD_FOX).length;
      if (close > 0) errors.push('Gardener too close to a fox (move ≥3 apart)');
      if (foxes.length && !this.allFoxesReachable(gpos, foxes)) errors.push('A fox is walled off from the gardener');
    }
    return { ok: errors.length === 0, errors };
  }

  // flood from gardener over passable cells (walls = fence/rock); every fox must be reachable
  private allFoxesReachable(g: [number, number], foxes: [number, number][]) {
    const seen = Array.from({ length: this.rows }, () => new Array(this.cols).fill(false));
    const stack = [g]; seen[g[0]]![g[1]] = true;
    while (stack.length) {
      const [r, c] = stack.pop()!;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols || seen[nr]![nc]) continue;
        const code = this.grid[nr]![nc]!;
        if (code === 0 || code === 7) continue; // fence / rock block
        seen[nr]![nc] = true; stack.push([nr, nc]);
      }
    }
    return foxes.every(([r, c]) => seen[r]![c]);
  }

  private onTest() {
    this.scene.launch('Game', {
      customMap: this.grid.map(r => r.slice()),
      testMode: true,
      gardenerSkin: this.gardenerSkin,
      foxSkin: this.foxSkin,
    });
    this.scene.sleep();
  }
  private onPublish() { this.showPublishModal(); }

  private showPublishModal() {
    const v = this.validateMap();
    const items: Phaser.GameObjects.GameObject[] = [];
    this.modalOpen = true;

    const close = () => {
      this.modalOpen = false;
      this.inputBlocked = true;
      this.time.delayedCall(200, () => { this.inputBlocked = false; });
      items.forEach(o => (o as { destroy(): void }).destroy());
    };

    // Full-screen dimmer
    const dimG = this.add.graphics().setDepth(200);
    dimG.fillStyle(0x000000, 0.72);
    dimG.fillRect(0, 0, this.W, this.H);
    const dimHit = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.001)
      .setDepth(200).setInteractive();
    items.push(dimG, dimHit);

    // Panel dimensions
    const mw = Math.min(this.W - 24, 520);
    const lineH = 17;
    const visErr = Math.min(v.errors.length, 3);
    const errBlockH = v.ok ? 32 : visErr * lineH + 16;
    const mh = 70 + 50 + errBlockH + 52 + 64 + 24; // title + input + status + verify row + buttons + padding
    const mx = (this.W - mw) / 2;
    const my = Math.max(12, (this.H - mh) / 2 - (this.portrait ? 20 : 0));

    const panelG = this.add.graphics().setDepth(201);
    panelG.fillStyle(0x0a1a0e, 1);
    panelG.fillRoundedRect(mx, my, mw, mh, 14);
    panelG.lineStyle(2, 0x2a5c38, 1);
    panelG.strokeRoundedRect(mx, my, mw, mh, 14);
    items.push(panelG);

    // Stop dimHit from swallowing clicks on the panel
    panelG.setInteractive(new Phaser.Geom.Rectangle(mx, my, mw, mh), Phaser.Geom.Rectangle.Contains);
    panelG.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: { stopPropagation: () => void }) => event.stopPropagation());

    // Heading
    const headTxt = this.add.text(this.W / 2, my + 30, 'Publish Game', {
      fontFamily: 'Arial Black', fontSize: '20px', color: '#7fe39a',
    }).setOrigin(0.5).setDepth(202);
    items.push(headTxt);

    // Title input
    const inpW = mw - 32;
    const inpCy = my + 95;
    const titleEl = this.add.dom(this.W / 2, inpCy, 'input',
      `box-sizing:border-box;width:${inpW}px;height:40px;font-size:16px;padding:0 12px;border:2px solid #2a5c38;border-radius:8px;background:#0d2118;color:#ffffff;outline:none;`);
    const inp = titleEl.node as HTMLInputElement;
    inp.type = 'text'; inp.maxLength = 48; inp.placeholder = 'Enter game name…'; inp.value = this.title;
    inp.addEventListener('input', () => { this.title = inp.value; });
    inp.addEventListener('focus', () => { inp.style.borderColor = '#ffd24a'; this.input.keyboard?.disableGlobalCapture(); });
    inp.addEventListener('blur', () => { inp.style.borderColor = '#2a5c38'; this.input.keyboard?.enableGlobalCapture(); });
    titleEl.setDepth(210);
    items.push(titleEl);
    setTimeout(() => inp.focus(), 60);

    // Validation status block
    const statusY = my + 120;
    if (v.ok) {
      const sg = this.add.graphics().setDepth(202);
      sg.fillStyle(0x163a22, 1);
      sg.fillRoundedRect(mx + 16, statusY, mw - 32, 32, 6);
      items.push(sg);
      const st = this.add.text(this.W / 2, statusY + 16, '✓  Ready to publish', {
        fontFamily: 'Arial', fontSize: '14px', color: '#7fe39a',
      }).setOrigin(0.5).setDepth(203);
      items.push(st);
    } else {
      const eg = this.add.graphics().setDepth(202);
      const epH = visErr * lineH + 14;
      eg.fillStyle(0x2a1212, 1);
      eg.fillRoundedRect(mx + 16, statusY, mw - 32, epH, 6);
      eg.lineStyle(1, 0x6b2020, 0.8);
      eg.strokeRoundedRect(mx + 16, statusY, mw - 32, epH, 6);
      items.push(eg);
      let ty = statusY + 7;
      for (let i = 0; i < visErr; i++) {
        const et = this.add.text(mx + 24, ty, `⚠ ${v.errors[i]}`, {
          fontFamily: 'Arial', fontSize: '11px', color: '#ffaaaa',
          wordWrap: { width: mw - 48 },
        }).setDepth(203);
        items.push(et); ty += lineH;
      }
      if (v.errors.length > visErr) {
        const more = this.add.text(mx + mw - 24, statusY + epH - 13, `+${v.errors.length - visErr} more`, {
          fontFamily: 'Arial', fontSize: '10px', color: '#ff7777',
        }).setOrigin(1, 0).setDepth(203);
        items.push(more);
      }
    }

    // Verify row
    const verifyY = statusY + errBlockH + 8;
    const vrW = mw - 32;
    const vrBg = this.add.graphics().setDepth(202);
    vrBg.fillStyle(0x0d1c10, 1);
    vrBg.fillRoundedRect(mx + 16, verifyY, vrW, 44, 6);
    items.push(vrBg);

    if (this.levelVerified) {
      const vt = this.add.text(mx + 24, verifyY + 22, '✓  Level completed!', {
        fontFamily: 'Arial', fontSize: '14px', color: '#7fe39a',
      }).setOrigin(0, 0.5).setDepth(203);
      items.push(vt);
    } else {
      const vtStatus = this.add.text(mx + 24, verifyY + 22, '✕  Complete level to verify it works', {
        fontFamily: 'Arial', fontSize: '13px', color: '#ff6666',
      }).setOrigin(0, 0.5).setDepth(203);
      items.push(vtStatus);

      const cbW = 150, cbH = 32;
      const cbX = mx + mw - 16 - cbW;
      const cbY = verifyY + (44 - cbH) / 2;
      const cbEnabled = v.ok;
      const cbG = this.add.graphics().setDepth(202);
      cbG.fillStyle(cbEnabled ? 0x2e50c8 : 0x1a1a1a, 1);
      cbG.fillRoundedRect(cbX, cbY, cbW, cbH, 6);
      cbG.lineStyle(1, cbEnabled ? 0x5b78e8 : 0x333333, 1);
      cbG.strokeRoundedRect(cbX, cbY, cbW, cbH, 6);
      items.push(cbG);
      const cbLbl = this.add.text(cbX + cbW / 2, cbY + cbH / 2, '🎮 Complete Level', {
        fontFamily: 'Arial Black', fontSize: '11px', color: cbEnabled ? '#ffffff' : '#444444',
      }).setOrigin(0.5).setDepth(203);
      items.push(cbLbl);
      if (cbEnabled) {
        const cbHit = this.add.rectangle(cbX + cbW / 2, cbY + cbH / 2, cbW, cbH, 0x000000, 0.001)
          .setDepth(204).setInteractive({ useHandCursor: true });
        cbHit.on('pointerdown', () => {
          close();
          try { localStorage.setItem('gg_verify_intent', '1'); } catch { /* ignore */ }
          this.onTest();
        });
        cbHit.on('pointerover', () => cbG.setAlpha(0.8));
        cbHit.on('pointerout', () => cbG.setAlpha(1));
        items.push(cbHit);
      }
    }

    // Buttons
    const btnY = my + mh - 68;
    const btnW = (mw - 56) / 2;

    const mkBtn = (bx: number, label: string, fill: number, stroke: number, onClick: () => void) => {
      const bg = this.add.graphics().setDepth(202);
      bg.fillStyle(fill, 1);
      bg.fillRoundedRect(bx, btnY, btnW, 44, 8);
      bg.lineStyle(2, stroke, 1);
      bg.strokeRoundedRect(bx, btnY, btnW, 44, 8);
      items.push(bg);
      const lbl = this.add.text(bx + btnW / 2, btnY + 22, label, {
        fontFamily: 'Arial Black', fontSize: '16px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(203);
      items.push(lbl);
      const hit = this.add.rectangle(bx + btnW / 2, btnY + 22, btnW, 44, 0x000000, 0.001)
        .setDepth(204).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', onClick);
      hit.on('pointerover', () => bg.setAlpha(0.8));
      hit.on('pointerout', () => bg.setAlpha(1));
      items.push(hit);
    };

    mkBtn(mx + 28, 'Cancel', 0x1c1c1c, 0x444444, close);
    mkBtn(mx + 28 + btnW + 16, 'Publish', v.ok ? 0x163a20 : 0x1c1c1c, v.ok ? 0x3dbd60 : 0x444444, () => {
      if (!v.ok) { this.toast('Fix validation issues first'); return; }
      close();
      const title = this.title.trim() || 'Untitled';
      fetch('/api/publishMap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, grid: this.grid, cols: this.cols, rows: this.rows, gardenerSkin: this.gardenerSkin, foxSkin: this.foxSkin, verified: this.levelVerified }),
      })
        .then(r => r.json() as Promise<{ type: string; author: string; postUrl: string }>)
        .then(d => { this.toast('Published!'); this.time.delayedCall(800, () => navigateTo(d.postUrl)); })
        .catch(() => this.toast('Publish failed – try again'));
    });
  }
  private toast(msg: string) {
    const ty = this.portrait ? this.H - this.barH - 20 : this.H - 20;
    const t = this.add.text(this.W / 2, ty, msg, {
      fontFamily: 'Arial', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#0d2118', padding: { x: 14, y: 7 },
      stroke: '#2a5c38', strokeThickness: 1,
    }).setOrigin(0.5, 1).setDepth(300);
    this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 500, onComplete: () => t.destroy() });
  }

  private toolList(): [Tool, string][] {
    return [['grass', 'Grass'], ['soil', 'Soil'], ['gardener', 'Garden'],
            ['fox', 'Fox'], ['veggie', 'Veggie'], ['rock', 'Rock']];
  }
  private actionList(): [string, () => void][] {
    return [['↶', () => this.undo()], ['↷', () => this.redo()],
            ['⟲', () => this.clearAll()], ['✕', () => this.scene.start('MainMenu')]];
  }

  // bottom bar (portrait): row1 tools | row2 size pills + actions | row3 Test + Publish
  private buildBottomBar() {
    const barTop = this.H - this.barH;
    this.addRect(this.W / 2, barTop + this.barH / 2, this.W, this.barH, 0x12150f);
    this.blockRects.push(new Phaser.Geom.Rectangle(0, barTop, this.W, this.barH));

    const tools = this.toolList();
    const gap = 6, availW = this.W - 2 * PAD;
    const tw = Math.min(62, Math.floor((availW - (tools.length - 1) * gap) / tools.length));
    const r1y = barTop + 6, th = 48;
    let x = (this.W - (tw * tools.length + gap * (tools.length - 1))) / 2;
    for (const [t, lbl] of tools) { this.dockBtn(x, r1y, tw, th, t, lbl); x += tw + gap; }

    // row 2 — W pill, H pill, actions (mute replaces ✕), centered
    const acts = this.portraitActionList();
    const aw = 36, ph = 36;
    const pillW = Phaser.Math.Clamp(Math.floor((availW - acts.length * aw - 5 * gap) / 2), 80, 116);
    const r2y = r1y + th + 6;
    const row2W = pillW * 2 + acts.length * aw + gap * (acts.length + 1);
    x = (this.W - row2W) / 2;
    this.sizePill(x, r2y, pillW, ph, 'W', 'W'); x += pillW + gap;
    this.sizePill(x, r2y, pillW, ph, 'H', 'H'); x += pillW + gap;
    for (const [label, fn] of acts) { this.iconBtn(x, r2y + (ph - 32) / 2, aw, 32, label, fn); x += aw + gap; }

    // row 3 — Test | Publish (always visible)
    const v = this.validateMap();
    const r3y = r2y + ph + 4;
    const half = (availW - gap) / 2;
    this.headerBtn(PAD, r3y, half, 28, '▶  Test', 0x1a3a26, 0xffd24a, false, () => this.onTest());
    this.headerBtn(PAD + half + gap, r3y, half, 28, 'Publish', v.ok ? 0x163a20 : 0x1c1c1c, v.ok ? 0x3dbd60 : 0x555555, false, () => this.onPublish());
  }

  // left rail (landscape): tools 2-col, size pills full-width, actions 2-col
  private buildLeftRail() {
    this.addRect(RAIL_W / 2, this.H / 2, RAIL_W, this.H, 0x161a17);
    this.blockRects.push(new Phaser.Geom.Rectangle(0, 0, RAIL_W, this.H));
    const gap = 8, colW = Math.floor((RAIL_W - 3 * gap) / 2), innerW = RAIL_W - 2 * gap;
    const x0 = gap, x1 = gap * 2 + colW;

    const tools = this.toolList();
    const th = 56;
    let y = PAD;
    for (let i = 0; i < tools.length; i++) {
      const [t, lbl] = tools[i]!;
      this.dockBtn(i % 2 === 0 ? x0 : x1, y, colW, th, t, lbl);
      if (i % 2 === 1) y += th + gap;
    }
    if (tools.length % 2 === 1) y += th + gap;

    y += 4;
    this.sizePill(gap, y, innerW, 40, 'W', 'W'); y += 46;
    this.sizePill(gap, y, innerW, 40, 'H', 'H'); y += 50;
    this.addText(RAIL_W / 2, y, `Grass ${this.grassW()}×${this.grassH()}`, 12, '#9fe09f', 0.5, 0.5); y += 18;

    const acts = this.actionList();
    for (let i = 0; i < acts.length; i++) {
      const [label, fn] = acts[i]!;
      this.iconBtn(i % 2 === 0 ? x0 : x1, y, colW, 40, label, fn);
      if (i % 2 === 1) y += 46;
    }

    y += 10;
    const v = this.validateMap();
    this.headerBtn(gap, y, innerW, 30, '▶  Test', 0x1a3a26, 0xffd24a, false, () => this.onTest()); y += 36;
    this.headerBtn(gap, y, innerW, 30, 'Publish', v.ok ? 0x163a20 : 0x1c1c1c, v.ok ? 0x3dbd60 : 0x555555, false, () => this.onPublish());
  }

  // validation errors overlaid on the grid — always visible on any device/layout
  private buildValidationOverlay() {
    const v = this.validateMap();
    if (v.ok) return;
    const gw = (this.cols - 2) * this.cell;
    const panelW = Math.min(Math.floor(gw * 0.62), 220);
    const lineH = 15;
    const visN = Math.min(v.errors.length, 4);
    const panelH = visN * lineH + 10;
    const px = this.ox + FENCE_PX + 6;
    const py = this.oy + FENCE_PX + 6;

    const d = 10; // depth above grid (which is 0)
    const bg = this.add.graphics().setDepth(d);
    bg.fillStyle(0x000000, 0.72);
    bg.fillRoundedRect(px, py, panelW, panelH, 6);
    this.uiObjs.push(bg);

    for (let i = 0; i < visN; i++) {
      const isLast = i === visN - 1 && v.errors.length > visN;
      const txt = isLast
        ? `  +${v.errors.length - visN + 1} more issues`
        : `⚠ ${v.errors[i]}`;
      const col = isLast ? '#ff7777' : '#ffccaa';
      const t = this.add.text(px + 6, py + 5 + i * lineH, txt, {
        fontFamily: 'Arial', fontSize: '11px', color: col,
        wordWrap: { width: panelW - 12 },
      }).setDepth(d + 1);
      this.uiObjs.push(t);
    }
  }

  // variant picker — overlays grid, transient; pick closes it
  private buildVariantFlyout() {
    const list: { key: string; name: string; sel: boolean; on: () => void; locked?: boolean; lockLabel?: string }[] =
      this.tool === 'gardener'
        ? GARDENER_SKINS.map((s, i) => ({ key: `gard_${i}`, name: i === 0 ? (this.username || s.name) : s.name, sel: this.gardenerSkin === i, on: () => { this.gardenerSkin = i; }, locked: !this.unlockedGardener.includes(i), lockLabel: GARDENER_UNLOCKS[i]?.label }))
      : this.tool === 'fox'
        ? FOX_SKINS.map((s, i) => ({ key: this.foxKey(i), name: s.name, sel: this.foxSkin === i, on: () => { this.foxSkin = i; }, locked: !this.unlockedFox.includes(i), lockLabel: FOX_UNLOCKS[i]?.label }))
      : VEGGIES.map((v, i) => ({ key: v.code === 5 ? 'pumpkin' : 'corn', name: v.name, sel: this.veggieIdx === i, on: () => { this.veggieIdx = i; } }));
    if (this.portrait) {
      // icon-only row above the bar
      const bw = 54, h = 56, gap = 6;
      const totalW = list.length * bw + (list.length - 1) * gap;
      const y = this.H - this.barH - 4 - h / 2;
      const flyoutTop = y - (h + 8) / 2;
      const gridBottom = this.oy + (this.rows - 2) * this.cell + 2 * FENCE_PX;
      const overlaps = gridBottom > flyoutTop;
      const pick = (fn: () => void) => () => {
        fn(); this.variantOpen = false;
        if (overlaps) { this.inputBlocked = true; this.time.delayedCall(150, () => { this.inputBlocked = false; }); }
        this.layout();
      };
      let x = Math.max(PAD, (this.W - totalW) / 2);
      this.addRect(this.W / 2, y, this.W, h + 8, 0x0c0c0c);
      this.blockRects.push(new Phaser.Geom.Rectangle(0, y - (h + 8) / 2, this.W, h + 8));
      for (const o of list) {
        const cb = o.locked ? () => this.toast(o.lockLabel ? `🔒 ${o.lockLabel}` : 'Locked') : pick(o.on);
        this.optBtn(x, y, bw, 48, o.key, null, o.sel, cb, o.locked); x += bw + gap;
      }
    } else {
      // labelled column right of the rail
      const pick = (fn: () => void) => () => { fn(); this.variantOpen = false; this.layout(); };
      const bw = 150, h = 44, gap = 6;
      const x = RAIL_W + 6;
      const totalH = list.length * h + (list.length - 1) * gap;
      let y = Math.max(PAD + h / 2, (this.H - totalH) / 2 + h / 2);
      this.addRect(x + bw / 2, this.H / 2, bw + 12, this.H, 0x0c0c0c);
      this.blockRects.push(new Phaser.Geom.Rectangle(x - 6, 0, bw + 12, this.H));
      for (const o of list) {
        const cb = o.locked ? () => this.toast(o.lockLabel ? `🔒 ${o.lockLabel}` : 'Locked') : pick(o.on);
        this.optBtn(x, y, bw, h - 4, o.key, o.name, o.sel, cb, o.locked); y += h + gap;
      }
    }
  }

  // ── widgets ───────────────────────────────────────────────────────────────
  private addRect(cx: number, cy: number, w: number, h: number, color: number) {
    const r = this.add.rectangle(cx, cy, w, h, color).setDepth(this.baseDepth - 3); this.uiObjs.push(r); return r;
  }
  private addText(x: number, y: number, txt: string, size: number, color: string, ox = 0, oy = 0) {
    const t = this.add.text(x, y, txt, { fontFamily: 'Arial', fontSize: `${size}px`, color }).setOrigin(ox, oy).setDepth(this.baseDepth + 1);
    this.uiObjs.push(t); return t;
  }
  private base(cx: number, cy: number, w: number, h: number, sel: boolean, onClick: () => void) {
    const r = this.add.rectangle(cx, cy, w, h, sel ? 0x2e3a2e : 0x232323).setDepth(this.baseDepth).setInteractive({ useHandCursor: true });
    r.setStrokeStyle(sel ? 3 : 1, sel ? 0xffd24a : 0x555555);
    r.on('pointerdown', onClick);
    r.on('pointerover', () => { if (!sel) r.setFillStyle(0x303030); });
    r.on('pointerout', () => { if (!sel) r.setFillStyle(0x232323); });
    this.uiObjs.push(r); return r;
  }
  private iconBtn(cx: number, cy: number, w: number, h: number, label: string, onClick: () => void) {
    this.base(cx + w / 2, cy + h / 2, w, h, false, onClick);
    this.addText(cx + w / 2, cy + h / 2, label, 16, '#ffffff', 0.5, 0.5);
    return true;
  }
  private dockBtn(x: number, y: number, w: number, h: number, tool: Tool, label: string) {
    const sel = this.tool === tool;
    this.base(x + w / 2, y + h / 2, w, h, sel, () => {
      if (this.tool === tool && this.isVariant(tool)) this.variantOpen = !this.variantOpen;
      else { this.tool = tool; this.variantOpen = this.isVariant(tool); }
      this.layout();
    });
    const sw = this.toolSwatch(tool);
    const iy = y + h / 2 - 6;
    if (sw !== null) { const s = this.add.rectangle(x + w / 2, iy, 26, 26, sw).setDepth(this.baseDepth + 1); this.uiObjs.push(s); }
    else {
      const key = tool === 'gardener' ? `gard_${this.gardenerSkin}` : tool === 'fox' ? this.foxKey(this.foxSkin) : tool === 'veggie' ? (VEGGIES[this.veggieIdx]!.code === 5 ? 'pumpkin' : 'corn') : 'rock_ico';
      const bg = this.add.rectangle(x + w / 2, iy, 30, 30, SOIL).setDepth(this.baseDepth + 1); this.uiObjs.push(bg);
      const img = this.add.image(x + w / 2, iy, key).setDisplaySize(28, 28).setDepth(this.baseDepth + 2); this.uiObjs.push(img);
    }
    if (this.isVariant(tool)) { const c = this.add.text(x + w - 4, y + 4, '▾', { fontFamily: 'Arial', fontSize: '11px', color: '#ffd24a' }).setOrigin(1, 0).setDepth(this.baseDepth + 2); this.uiObjs.push(c); }
    this.addText(x + w / 2, y + h - 9, label, 11, '#dddddd', 0.5, 0.5);
  }
  private toolSwatch(t: Tool): number | null {
    return t === 'grass' ? GRASS : t === 'soil' ? SOIL : t === 'rock' ? ROCK : null;
  }
  private optBtn(x: number, cy: number, w: number, h: number, texKey: string, label: string | null, sel: boolean, onClick: () => void, locked = false) {
    this.base(x + w / 2, cy, w, h, locked ? false : sel, onClick);
    const icx = label === null ? x + w / 2 : x + 22;
    const bg = this.add.rectangle(icx, cy, 34, 34, SOIL).setDepth(this.baseDepth + 1); this.uiObjs.push(bg);
    const img = this.add.image(icx, cy, texKey).setDisplaySize(32, 32).setDepth(this.baseDepth + 2); this.uiObjs.push(img);
    if (locked) {
      img.setAlpha(0.35);
      const lk = this.add.text(icx, cy, '🔒', { fontSize: '18px' }).setOrigin(0.5).setDepth(this.baseDepth + 3); this.uiObjs.push(lk);
    }
    if (label !== null) this.addText(x + 42, cy, label, 12, locked ? '#888888' : '#eeeeee', 0, 0.5);
  }

  // W/H pill: [label][−][value(tap to type)][+]
  private sizePill(x: number, y: number, w: number, h: number, label: string, which: 'W' | 'H') {
    const val = which === 'W' ? this.cols - 2 : this.rows - 2;
    const bg = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x232323).setStrokeStyle(1, 0x555555).setDepth(this.baseDepth); this.uiObjs.push(bg);
    const sb = 28; // stepper button size
    this.addText(x + 8, y + h / 2, label, 14, '#9fe09f', 0, 0.5);
    const labW = 22;
    const minusX = x + labW, plusX = x + w - sb - 4;
    this.stepBtn(minusX, y + (h - sb) / 2, sb, '−', () => this.setDim(which, -1));
    this.stepBtn(plusX, y + (h - sb) / 2, sb, '+', () => this.setDim(which, +1));
    const numCx = (minusX + sb + plusX) / 2;
    const hit = this.add.rectangle(numCx, y + h / 2, plusX - (minusX + sb), h - 6, 0x000000, 0.001).setDepth(this.baseDepth + 1).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.editDim(which, numCx, y + h / 2));
    this.uiObjs.push(hit);
    this.addText(numCx, y + h / 2, `${val}`, 18, '#ffffff', 0.5, 0.5);
  }
  private stepBtn(x: number, y: number, s: number, label: string, onClick: () => void) {
    const r = this.add.rectangle(x + s / 2, y + s / 2, s, s, 0x303030).setStrokeStyle(1, 0x666666).setDepth(this.baseDepth + 1).setInteractive({ useHandCursor: true });
    r.on('pointerdown', onClick); this.uiObjs.push(r);
    this.addText(x + s / 2, y + s / 2, label, 18, '#ffffff', 0.5, 0.5);
  }

  // tap-to-type dimension entry via DOM input overlay
  private editDim(which: 'W' | 'H', cx: number, cy: number) {
    if (this.dimInput) { this.dimInput.destroy(); this.dimInput = null; }
    const cur = which === 'W' ? this.cols - 2 : this.rows - 2;
    const el = this.add.dom(cx, cy, 'input',
      'width:56px;height:32px;font-size:18px;text-align:center;border:2px solid #ffd24a;border-radius:6px;background:#1c2018;color:#fff;outline:none;');
    const inp = el.node as HTMLInputElement;
    inp.type = 'text'; inp.inputMode = 'numeric'; inp.maxLength = 2; inp.value = String(cur);
    el.setDepth(200); this.dimInput = el;
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    let done = false;
    const commit = (apply: boolean) => {
      if (done) return; done = true;
      const v = parseInt(inp.value, 10);
      el.destroy(); this.dimInput = null;
      if (apply && !isNaN(v) && v !== cur) this.setDimTo(which, v);
    };
    inp.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    inp.addEventListener('blur', () => commit(true));
  }

  // ── textures ──────────────────────────────────────────────────────────────
  private makeTextures() {
    const T = 64;
    const draw = (key: string, fn: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0 }); fn(g); g.generateTexture(key, T, T); g.destroy();
    };
    makeSkinTextures(this);
    draw('pumpkin', (g) => {
      g.fillStyle(0xe8731c); g.fillEllipse(32, 39, 42, 36);
      g.fillStyle(0xcf6314); g.fillEllipse(20, 39, 10, 30); g.fillEllipse(44, 39, 10, 30);
      g.fillStyle(0xf5862a); g.fillEllipse(32, 39, 12, 34);
      g.fillStyle(0x3a7d2c); g.fillRect(29, 15, 6, 10);
    });
    draw('corn', (g) => {
      g.fillStyle(0x4c9a2a); g.fillTriangle(18, 32, 32, 18, 30, 52); g.fillTriangle(46, 32, 32, 18, 34, 52);
      g.fillStyle(0xf2c200); g.fillEllipse(32, 40, 20, 40);
      g.fillStyle(0xd9a400); for (let yy = 26; yy <= 52; yy += 6) for (let xx = 26; xx <= 38; xx += 6) g.fillCircle(xx, yy, 1.5);
    });
    draw('rock_ico', (g) => {
      g.fillStyle(0x5f6266); g.fillRoundedRect(10, 16, 44, 38, 10);
      g.fillStyle(ROCK); g.fillRoundedRect(13, 19, 38, 32, 9);
      g.fillStyle(0xb8bbbf); g.fillEllipse(26, 30, 14, 8);
    });
  }
}
