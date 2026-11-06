import { Scene } from 'phaser';
import levels from '../levels.json';
import { foxKey, makeSkinTextures, fitSize } from '../skins';
import type { SubmitScoreResponse } from '../../shared/api';

// 0=fence 1=soil 2=hedge(grass, pushable) 3=gardener 4=fox 5=pumpkin 6=corn
// Grid: fence(0) is a thin drawn border, not a real cell → playfield = inner (N-2)².
//   "Playable" size = array−2. Arrays shipped: 18×18 (16² play, 10² centre), 19×19 (17²
//   play, 11² centre), 23×23 (21² play, 15² centre). 3-thick soil ring (fox zone), block
//   centre, gardener mid. Dims read dynamically (nr/nc), not hardcoded.
// Maps live in src/client/levels.json (shared with tools/solve.mjs solvability checker).
const MAPS = levels.maps as number[][][];
const FOX_SPEEDS = levels.foxSpeeds as number[];
const HDR = 24;
const FENCE_PX = 4; // thin fence border replaces full fence cells

interface Pos { r: number; c: number; }
interface Fox extends Pos { alive: boolean; sprite: Phaser.GameObjects.Image | null; }
interface Veggie extends Pos { type: 'pumpkin' | 'corn'; eaten: boolean; sprite: Phaser.GameObjects.Image | null; }
type Status = 'playing' | 'death_pause' | 'level_done' | 'game_over' | 'win';

const DIRS8 = [
  {dr:-1,dc:-1},{dr:-1,dc:0},{dr:-1,dc:1},
  {dr:0,dc:-1},              {dr:0,dc:1},
  {dr:1,dc:-1}, {dr:1,dc:0},{dr:1,dc:1},
];
const DIRS4 = [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1}];

export class Game extends Scene {
  private grid!: number[][];
  private gardener!: Pos;
  private foxes!: Fox[];
  private veggies!: Veggie[];

  private lives = 3;
  private score = 0;
  private elapsed = 0;
  private level = 0;
  private status: Status = 'playing';
  private foxTimer = 0;
  private moveCooldown = 0;

  private S = 0;
  private ox = 0;
  private oy = 0;

  private tilesG!: Phaser.GameObjects.Graphics;
  private animGrassG!: Phaser.GameObjects.Graphics;
  private animGrassCells: { r: number; c: number }[] = [];
  private grassFrame = 0;
  private gardenerSprite!: Phaser.GameObjects.Image;
  private livesText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private levelLabel!: Phaser.GameObjects.Text;
  private hudTexts: Phaser.GameObjects.GameObject[] = [];
  private overlayG: Phaser.GameObjects.Graphics | null = null;
  private overlayItems: Phaser.GameObjects.GameObject[] = [];
  private countdownEvent: Phaser.Time.TimerEvent | undefined;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private touchLast: { x: number; y: number } | null = null;
  private nr = 0;
  private nc = 0;
  private initMapData: number[][] = [];
  private testMode = false;
  private isCustom = false;
  private customMap: number[][] | null = null;
  private gardenerSkin = 0;
  private foxSkin = 0;
  private puzzleNumber: number | undefined = undefined;

  constructor() { super('Game'); }

  init(data?: { customMap?: number[][]; testMode?: boolean; isCustom?: boolean; gardenerSkin?: number; foxSkin?: number; puzzleNumber?: number; customMapTitle?: string }) {
    this.testMode = data?.testMode ?? false;
    this.isCustom = data?.isCustom ?? false;
    this.customMap = data?.customMap ? data.customMap.map(r => r.slice()) : null;
    this.gardenerSkin = data?.gardenerSkin ?? 0;
    this.foxSkin = data?.foxSkin ?? 0;
    this.puzzleNumber = data?.puzzleNumber;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x111111);
    this.tilesG = this.add.graphics().setDepth(0);
    this.animGrassG = this.add.graphics().setDepth(0.1);
    this.time.addEvent({ delay: 333, loop: true, callback: () => {
      this.grassFrame ^= 1;
      this.drawGrassAnim();
    } });
    this.level = 0;
    this.lives = 3;
    this.score = 0;
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.setupTouch();
    makeSkinTextures(this);
    this.initLevel();
  }

  private get W() { return this.scale.width; }
  private get H() { return this.scale.height; }
  private cx(c: number) { return this.ox + FENCE_PX + (c - 1) * this.S + this.S / 2; }
  private cy(r: number) { return this.oy + FENCE_PX + (r - 1) * this.S + this.S / 2; }

  // ── INIT ──────────────────────────────────────────────────────────────────

  private initLevel() {
    this.foxes?.forEach(f => f.sprite?.destroy());
    this.veggies?.forEach(v => v.sprite?.destroy());
    this.gardenerSprite?.destroy();
    this.hudTexts.forEach(t => t.destroy());
    this.hudTexts = [];
    this.clearOverlay();

    this.elapsed = 0;
    this.foxTimer = 0;
    this.moveCooldown = 0;
    this.status = 'playing';

    const gameIdx = (this.testMode || this.isCustom) ? 0 : ((this.puzzleNumber ?? 1) - 1) % (MAPS.length / 3);
    const raw = (((this.testMode || this.isCustom) && this.customMap) ? this.customMap : MAPS[gameIdx * 3 + this.level])!;
    this.initMapData = raw;
    this.nr = raw.length;
    this.nc = raw[0]!.length;
    this.grid = raw.map(row => [...row]);
    this.gardener = { r: 0, c: 0 };
    this.foxes = [];
    this.veggies = [];

    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) {
        const t = this.grid[r]![c]!;
        if (t === 3) { this.gardener = { r, c }; this.grid[r]![c] = 1; }
        else if (t === 4) { this.foxes.push({ r, c, alive: true, sprite: null }); this.grid[r]![c] = 1; }
        else if (t === 5) { this.veggies.push({ r, c, type: 'pumpkin', eaten: false, sprite: null }); this.grid[r]![c] = 1; }
        else if (t === 6) { this.veggies.push({ r, c, type: 'corn', eaten: false, sprite: null }); this.grid[r]![c] = 1; }
      }
    }

    const innerC = this.nc - 2, innerR = this.nr - 2;
    this.S = Math.floor(Math.min(this.W / innerC, (this.H - HDR) / innerR));
    const fw = innerC * this.S + 2 * FENCE_PX, fh = innerR * this.S + 2 * FENCE_PX;
    this.ox = Math.floor((this.W - fw) / 2);
    this.oy = HDR + Math.floor((this.H - HDR - fh) / 2);

    this.buildTiles();
    this.buildSprites();
    this.buildHUD();
  }

  // ── RENDER TILES ──────────────────────────────────────────────────────────

  private buildTiles() {
    const g = this.tilesG; g.clear();
    const S = this.S, fx = this.ox, fy = this.oy;
    const innerC = this.nc - 2, innerR = this.nr - 2;
    const innerW = innerC * S, innerH = innerR * S;

    // Seeded hash for grass anim placement — uniform distribution, no diagonal clusters
    const rng = (r: number, c: number) => {
      const h = Math.imul(r * 374761393 + c * 668265263, 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
    };

    this.animGrassCells = [];
    const animSet = new Set<string>();
    for (let r = 1; r < this.nr - 1; r++) {
      for (let c = 1; c < this.nc - 1; c++) {
        const x = fx + FENCE_PX + (c - 1) * S, y = fy + FENCE_PX + (r - 1) * S;
        const t = this.grid[r]![c]!;
        if (t === 1) {
          g.fillStyle(0xCBA877); g.fillRect(x, y, S, S);
        } else if (t === 7) {
          g.fillStyle(0xCBA877); g.fillRect(x, y, S, S);
          g.fillStyle(0x5F6266); g.fillRoundedRect(x + 2, y + 2, S - 4, S - 4, Math.max(2, S / 6));
          g.fillStyle(0x8A8D91); g.fillRoundedRect(x + 3, y + 3, S - 7, S - 7, Math.max(2, S / 6));
        } else {
          g.fillStyle(0x63B845); g.fillRect(x, y, S, S);            // 1px light gridline
          g.fillStyle(0x3C8E2C); g.fillRect(x + 1, y + 1, S - 2, S - 2);
          // sparse, faint grass tuft on ~30% of cells (quiet board → sprites pop)
          const h = rng(r, c);
          if (h < 0.30 && S >= 10) {
            const mw = Math.max(1, Math.floor(S * 0.22));
            g.fillStyle(0x5AA03F);
            g.fillRect(x + Math.floor(S * 0.32), y + Math.floor(S * 0.30), mw, 1);
            g.fillRect(x + Math.floor(S * 0.44), y + Math.floor(S * 0.56), mw, 1);
          }
          // small subset of tufts animate; skip if a diagonal neighbour is already selected
          if (h < 0.10) {
            const noDiag = !animSet.has(`${r-1},${c-1}`) && !animSet.has(`${r-1},${c+1}`)
                        && !animSet.has(`${r+1},${c-1}`) && !animSet.has(`${r+1},${c+1}`);
            if (noDiag) { animSet.add(`${r},${c}`); this.animGrassCells.push({ r, c }); }
          }
        }
      }
    }

    // Thin fence border
    g.fillStyle(0x35C7DD);
    g.fillRect(fx, fy, innerW + 2 * FENCE_PX, FENCE_PX);
    g.fillRect(fx, fy + FENCE_PX + innerH, innerW + 2 * FENCE_PX, FENCE_PX);
    g.fillRect(fx, fy + FENCE_PX, FENCE_PX, innerH);
    g.fillRect(fx + FENCE_PX + innerW, fy + FENCE_PX, FENCE_PX, innerH);
    g.lineStyle(2, 0x0a1f12, 1); g.strokeRect(fx, fy, innerW + 2 * FENCE_PX, innerH + 2 * FENCE_PX);

    this.drawGrassAnim();
  }

  private drawGrassAnim() {
    const ag = this.animGrassG; ag.clear();
    const S = this.S;
    if (S < 8) return;
    const mw = Math.max(1, Math.floor(S * 0.22));
    const sh = this.grassFrame === 0 ? 0 : Math.floor(S * 0.13);
    ag.fillStyle(0x6CB84A, 0.55);
    for (const { r, c } of this.animGrassCells) {
      const x = this.ox + FENCE_PX + (c - 1) * S;
      const y = this.oy + FENCE_PX + (r - 1) * S;
      ag.fillRect(x + 2 + sh, y + Math.floor(S * 0.28), mw, 1);
      ag.fillRect(x + Math.floor(S * 0.45) + sh, y + Math.floor(S * 0.62), mw, 1);
    }
  }

  private buildSprites() {
    const S = this.S;
    const gKey = `gard_${this.gardenerSkin}`;
    const fKey = foxKey(this.foxSkin);
    // Skin 0's snoovatar carries transparent padding (cross-origin blocks auto-cropping it), so give it
    // a slightly bigger box than the pixel-art skins to fill the cell without overflowing it.
    const gbox = this.gardenerSkin === 0 ? S * 1.3 : S * 1.28;
    const gsz = fitSize(this, gKey, gbox);
    // gard_0 (the real snoovatar) carries a LINEAR filter (set in Preloader) so the Canvas renderer
    // smooth-scales it despite the global pixelArt setting; other skins stay crisp pixel-art.
    this.gardenerSprite = this.add.image(this.cx(this.gardener.c), this.cy(this.gardener.r), gKey)
      .setDisplaySize(gsz.w, gsz.h).setDepth(1);

    const fsz = fitSize(this, fKey, S * 1.28); // fox fills the cell (gentle overflow, sits on top)
    for (const fox of this.foxes) {
      fox.sprite = this.add.image(this.cx(fox.c), this.cy(fox.r), fKey)
        .setDisplaySize(fsz.w, fsz.h).setDepth(1);
    }
    for (const v of this.veggies) {
      v.sprite = this.add.image(this.cx(v.c), this.cy(v.r), v.type)
        .setDisplaySize(S * 0.82, S * 0.82).setDepth(1);
    }
  }

  private buildHUD() {
    const fs = (n: number) => `${Math.max(11, Math.floor(n))}px`;
    const S = this.S;
    const heartSize = Math.max(18, Math.floor(S * 0.55));
    const hcy = HDR / 2;

    this.livesText = this.add.text(10, hcy, this.livesStr(), {
      fontFamily: 'Arial Black', fontSize: `${heartSize}px`, color: '#FF4444',
    }).setOrigin(0, 0.5).setDepth(2);

    this.levelLabel = this.add.text(this.W / 2 - 8, hcy, this.testMode ? 'TEST' : `Level ${this.level + 1}`, {
      fontFamily: 'Arial Black', fontSize: fs(S * 0.38), color: this.testMode ? '#88FFCC' : '#FFFFFF',
    }).setOrigin(1, 0.5).setDepth(2);

    this.timerText = this.add.text(this.W / 2 + 8, hcy, '00:00', {
      fontSize: fs(S * 0.3), color: '#AAFFAA',
    }).setOrigin(0, 0.5).setDepth(2);

    this.scoreText = this.add.text(this.W - 32, hcy, `pts: ${this.score}`, {
      fontSize: fs(S * 0.34), color: '#FFD700',
    }).setOrigin(1, 0.5).setDepth(2);

    const muteIcon = this.add.text(this.W - 6, hcy, localStorage.getItem('gg_mute') === '1' ? '🔇' : '🔊', {
      fontSize: '14px',
    }).setOrigin(1, 0.5).setDepth(2).setInteractive({ useHandCursor: true });
    muteIcon.on('pointerdown', () => {
      const muted = !this.sound.mute;
      this.sound.mute = muted;
      localStorage.setItem('gg_mute', muted ? '1' : '0');
      muteIcon.setText(muted ? '🔇' : '🔊');
    });

    this.hudTexts = [this.livesText, this.levelLabel, this.scoreText, this.timerText, muteIcon];

    if (this.testMode) {
      const btnH = 40;
      const btnW = Math.min(220, Math.floor(this.W * 0.55));
      const portrait = this.H >= this.W;
      const gridBottom = this.oy + 2 * FENCE_PX + (this.nr - 2) * this.S;
      // portrait: centred below grid; landscape: bottom-right corner
      const btnX = portrait ? Math.floor((this.W - btnW) / 2) : this.W - 10 - btnW;
      const btnY = portrait ? gridBottom + 10 : this.H - 10 - btnH;

      const btnG = this.add.graphics().setDepth(2);
      btnG.fillStyle(0x163a20, 1);
      btnG.fillRoundedRect(btnX, btnY, btnW, btnH, 6);
      btnG.lineStyle(2, 0xffd24a, 0.9);
      btnG.strokeRoundedRect(btnX, btnY, btnW, btnH, 6);
      this.hudTexts.push(btnG);

      const btnLabel = this.add.text(btnX + btnW / 2, btnY + btnH / 2, 'Return to Editor', {
        fontFamily: 'Arial Black', fontSize: fs(S * 0.42), color: '#ffffff',
      }).setOrigin(0.5).setDepth(3);
      this.hudTexts.push(btnLabel);

      const hit = this.add.rectangle(btnX + btnW / 2, btnY + btnH / 2, btnW, btnH, 0x000000, 0.001)
        .setDepth(3).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.exitTestMode());
      hit.on('pointerover', () => btnG.setAlpha(0.75));
      hit.on('pointerout', () => btnG.setAlpha(1));
      this.hudTexts.push(hit);
    }
  }

  private livesStr() {
    return this.lives > 0 ? Array(this.lives).fill('♥').join(' ') : '☠';
  }

  // ── TOUCH INPUT ───────────────────────────────────────────────────────────

  private setupTouch() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.touchLast = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.touchLast) return;
      const dx = p.x - this.touchLast.x;
      const dy = p.y - this.touchLast.y;
      const thresh = this.S * 0.6;
      if (Math.abs(dx) > thresh || Math.abs(dy) > thresh) {
        if (Math.abs(dx) > Math.abs(dy)) this.tryMove({ dr: 0, dc: dx > 0 ? 1 : -1 });
        else this.tryMove({ dr: dy > 0 ? 1 : -1, dc: 0 });
        this.touchLast = { x: p.x, y: p.y };
      }
    });
    this.input.on('pointerup', () => { this.touchLast = null; });
  }

  // ── MOVEMENT ──────────────────────────────────────────────────────────────

  private tryMove(dir: { dr: number; dc: number }) {
    if (this.status !== 'playing') return;
    const { dr, dc } = dir;
    const nr = this.gardener.r + dr, nc = this.gardener.c + dc;
    if (nr < 0 || nr >= this.nr || nc < 0 || nc >= this.nc) return;
    const t = this.grid[nr]![nc]!;
    if (t === 0 || t === 7) return; // fence / rock: immovable walls
    if (t === 2 && !this.pushChain(nr, nc, dr, dc)) return;

    this.gardener.r = nr; this.gardener.c = nc;
    this.gardenerSprite.setPosition(this.cx(nc), this.cy(nr));

    for (const v of this.veggies) {
      if (!v.eaten && v.r === nr && v.c === nc) {
        v.eaten = true; v.sprite?.destroy(); v.sprite = null;
        this.score += 100;
        this.scoreText?.setText(`pts: ${this.score}`);
        this.floatPoints(nc, nr, '+100', '#FFD700');
      }
    }

    for (const fox of this.foxes) {
      if (fox.alive && fox.r === nr && fox.c === nc) { this.onDeath(); return; }
    }
    this.checkTraps();
  }

  private pushChain(startR: number, startC: number, dr: number, dc: number): boolean {
    const chain: Pos[] = [];
    let r = startR, c = startC;
    while (r >= 0 && r < this.nr && c >= 0 && c < this.nc && this.grid[r]![c]! === 2) {
      chain.push({ r, c }); r += dr; c += dc;
    }
    if (r < 0 || r >= this.nr || c < 0 || c >= this.nc) return false;
    if (this.grid[r]![c]! === 0 || this.grid[r]![c]! === 7) return false; // can't push into fence/rock
    if (this.foxes.some(f => f.alive && f.r === r && f.c === c)) return false;

    for (let i = chain.length - 1; i >= 0; i--) {
      const h = chain[i]!;
      this.grid[h.r + dr]![h.c + dc] = 2;
      this.grid[h.r]![h.c] = 1;
    }
    this.buildTiles();
    this.refreshVeggieVisibility();
    return true;
  }

  private refreshVeggieVisibility() {
    for (const v of this.veggies) {
      if (!v.eaten) v.sprite?.setVisible(this.grid[v.r]?.[v.c] !== 2);
    }
  }

  private checkTraps() {
    // Identify all newly trapped foxes before killing any — handles mutual pinning.
    const toKill = this.foxes.filter(fox => {
      if (!fox.alive) return false;
      return DIRS4.every(({ dr, dc }) => {
        const nr = fox.r + dr, nc = fox.c + dc;
        if (nr < 0 || nr >= this.nr || nc < 0 || nc >= this.nc) return true;
        if (this.grid[nr]![nc]! === 0 || this.grid[nr]![nc]! === 2 || this.grid[nr]![nc]! === 7) return true;
        return this.foxes.some(f => f !== fox && f.alive && f.r === nr && f.c === nc);
      });
    });
    for (const fox of toKill) {
      fox.alive = false;
      fox.sprite?.destroy(); fox.sprite = null;
      this.score += 100;
      this.scoreText?.setText(`pts: ${this.score}`);
      this.floatPoints(fox.c, fox.r, '+100', '#FFD700');
    }
    if (toKill.length > 0 && this.foxes.every(f => !f.alive)) this.onLevelWin();
  }

  // ── FOX AI ────────────────────────────────────────────────────────────────

  private moveFoxes() {
    if (this.status !== 'playing') return;
    for (const fox of this.foxes) {
      if (!fox.alive) continue;
      const next = this.foxBFS(fox);
      if (!next) continue;
      fox.r = next.r; fox.c = next.c;
      fox.sprite?.setPosition(this.cx(next.c), this.cy(next.r));

      for (const v of this.veggies) {
        if (!v.eaten && v.r === fox.r && v.c === fox.c) {
          v.eaten = true; v.sprite?.destroy(); v.sprite = null;
          this.score = Math.max(0, this.score - 50);
          this.scoreText?.setText(`pts: ${this.score}`);
          this.floatPoints(fox.c, fox.r, '-50', '#FF5555');
        }
      }
      if (fox.r === this.gardener.r && fox.c === this.gardener.c) {
        this.onDeath(); return;
      }
    }
    this.checkTraps();
  }

  private foxBFS(fox: Fox): Pos | null {
    const target = this.gardener;
    if (fox.r === target.r && fox.c === target.c) return null;

    const visited: boolean[][] = Array.from({ length: this.nr }, () => Array(this.nc).fill(false));
    const parent: (Pos | null)[][] = Array.from({ length: this.nr }, () => Array(this.nc).fill(null));
    visited[fox.r]![fox.c] = true;
    const queue: Pos[] = [{ r: fox.r, c: fox.c }];

    outer: while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const { dr, dc } of DIRS8) {
        const nr = curr.r + dr, nc = curr.c + dc;
        if (nr < 0 || nr >= this.nr || nc < 0 || nc >= this.nc) continue;
        if (visited[nr]![nc]!) continue;
        if (this.grid[nr]![nc]! === 0 || this.grid[nr]![nc]! === 2 || this.grid[nr]![nc]! === 7) continue;
        if (this.foxes.some(f => f !== fox && f.alive && f.r === nr && f.c === nc)) continue;
        visited[nr]![nc] = true;
        parent[nr]![nc] = curr;
        if (nr === target.r && nc === target.c) break outer;
        queue.push({ r: nr, c: nc });
      }
    }

    if (visited[target.r]![target.c]!) {
      // Trace back path to find first step
      let pos: Pos = target;
      while (parent[pos.r]![pos.c] &&
             (parent[pos.r]![pos.c]!.r !== fox.r || parent[pos.r]![pos.c]!.c !== fox.c)) {
        pos = parent[pos.r]![pos.c]!;
      }
      return pos;
    }

    // No direct path — greedy fallback: move to adjacent soil cell closest to gardener
    // This keeps the fox visibly patrolling even when blocked by hedges
    let best: Pos | null = null;
    let bestDist = Infinity;
    for (const { dr, dc } of DIRS8) {
      const nr = fox.r + dr, nc = fox.c + dc;
      if (nr < 0 || nr >= this.nr || nc < 0 || nc >= this.nc) continue;
      if (this.grid[nr]![nc]! === 0 || this.grid[nr]![nc]! === 2 || this.grid[nr]![nc]! === 7) continue;
      if (this.foxes.some(f => f !== fox && f.alive && f.r === nr && f.c === nc)) continue;
      const dist = Math.abs(nr - target.r) + Math.abs(nc - target.c);
      if (dist < bestDist) { bestDist = dist; best = { r: nr, c: nc }; }
    }
    return best;
  }

  // ── DEATH / WIN / LOSS ────────────────────────────────────────────────────

  private onDeath() {
    if (this.status !== 'playing') return;
    this.lives--;
    this.livesText?.setText(this.livesStr());
    this.status = 'death_pause';
    this.cameras.main.flash(300, 220, 0, 0, false);

    if (this.lives <= 0) {
      this.time.delayedCall(900, () => this.showGameOver());
    } else {
      this.time.delayedCall(800, () => {
        const start = this.getGardenerStart();
        this.gardener = start;
        this.gardenerSprite?.setPosition(this.cx(start.c), this.cy(start.r));
        this.status = 'playing';
      });
    }
  }

  private getGardenerStart(): Pos {
    const raw = this.initMapData;
    for (let r = 0; r < this.nr; r++)
      for (let c = 0; c < this.nc; c++)
        if (raw[r]![c] === 3) return { r, c };
    return { r: 5, c: 7 };
  }

  private onLevelWin() {
    if (this.status !== 'playing') return;
    const timeBonus = Math.max(0, 1000 - Math.floor(this.elapsed) * 10);
    this.score += timeBonus;
    this.status = 'level_done';
    this.time.delayedCall(600, () => {
      if (this.testMode) this.showTestWin(timeBonus);
      else if (this.isCustom || this.level >= 2) this.showWin();
      else this.showLevelComplete(timeBonus);
    });
  }

  private exitTestMode() {
    this.scene.wake('Editor');
    this.scene.stop();
  }

  private showTestWin(timeBonus: number) {
    try {
      if (localStorage.getItem('gg_verify_intent') === '1') {
        localStorage.removeItem('gg_verify_intent');
        localStorage.setItem('gg_verify_result', 'won');
      }
    } catch { /* ignore */ }
    this.overlay();
    const cx = this.W / 2, cy = this.H / 2;
    const fsz = (n: number) => `${Math.max(12, Math.floor(n))}px`;
    const S = this.S;
    this.oText(cx, cy - 70, 'Test Complete!',
      { fontFamily: 'Arial Black', fontSize: fsz(S * 0.62), color: '#00FF88' });
    this.oText(cx, cy - 20, `Time bonus: +${timeBonus}`,
      { fontSize: fsz(S * 0.38), color: '#AAFFAA' });
    this.oText(cx, cy + 8, `Score: ${this.score}`,
      { fontSize: fsz(S * 0.42), color: '#FFD700' });
    this.oBtn(cx, cy + 56, 'Play Again', '#FFFFFF', '#1A1A3A', () => {
      this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
    });
    this.oBtn(cx, cy + 112, 'Back to Editor', '#88FF88', '#1A3A1A', () => this.exitTestMode());
  }

  // ── OVERLAYS ──────────────────────────────────────────────────────────────

  private clearOverlay() {
    this.overlayG?.destroy(); this.overlayG = null;
    this.overlayItems.forEach(i => (i as Phaser.GameObjects.GameObject & { destroy(): void }).destroy());
    this.overlayItems = [];
    this.countdownEvent?.remove(); this.countdownEvent = undefined;
  }

  private overlay(alpha = 0.78) {
    this.clearOverlay();
    this.overlayG = this.add.graphics().setDepth(3);
    this.overlayG.fillStyle(0x000000, alpha);
    this.overlayG.fillRect(0, 0, this.W, this.H);
    return this.overlayG;
  }

  private oText(x: number, y: number, txt: string, style: Phaser.Types.GameObjects.Text.TextStyle) {
    const t = this.add.text(x, y, txt, style).setOrigin(0.5).setDepth(4);
    this.overlayItems.push(t);
    return t;
  }

  private oBtn(x: number, y: number, txt: string, color: string, bg: string, cb: () => void, fontScale = 1, fixedW?: number) {
    const padY = Math.max(6, 10 * fontScale);
    const btn = this.add.text(x, y, txt, {
      fontFamily: 'Arial Black', fontSize: `${Math.max(12, Math.floor(this.S * 0.4 * fontScale))}px`,
      color, backgroundColor: bg, align: 'center',
      padding: { x: Math.max(10, 18 * fontScale), y: padY },
    }).setOrigin(0.5).setDepth(4).setInteractive({ useHandCursor: true });
    if (fixedW) btn.setFixedSize(fixedW, btn.height);
    btn.on('pointerover', () => btn.setAlpha(0.8));
    btn.on('pointerout', () => btn.setAlpha(1));
    btn.on('pointerdown', cb);
    this.overlayItems.push(btn);
    return btn;
  }

  private showLevelComplete(timeBonus: number) {
    this.overlay();
    const cx = this.W / 2, cy = this.H / 2;
    const fsz = (n: number) => `${Math.max(12, Math.floor(n))}px`;
    const S = this.S;
    this.oText(cx, cy - 90, `Level ${this.level + 1} Complete!`,
      { fontFamily: 'Arial Black', fontSize: fsz(S * 0.62), color: '#FFD700' });
    this.oText(cx, cy - 38, `Fox trapped: +100 pts`,
      { fontSize: fsz(S * 0.38), color: '#FFFFFF' });
    this.oText(cx, cy - 10, `Time bonus: +${timeBonus} pts`,
      { fontSize: fsz(S * 0.38), color: '#AAFFAA' });
    this.oText(cx, cy + 18, `Total Score: ${this.score}`,
      { fontSize: fsz(S * 0.42), color: '#FFD700' });

    const newLives = Math.min(this.lives + 1, 5);
    this.oBtn(cx, cy + 68, `Next Level  (♥ ${newLives})`, '#00FF88', '#1A4A1A', () => {
      this.lives = newLives;
      this.level++;
      this.initLevel();
    });
  }

  private showGameOver() {
    this.status = 'game_over';
    this.overlay(0.85);
    const cx = this.W / 2;
    const S = this.S;
    const fsz = (n: number) => `${Math.max(9, Math.floor(n))}px`;
    const isDaily = !this.testMode && !this.isCustom;
    const score = this.score;

    if (isDaily) {
      // Nominal (k=1) vertical spread of the whole block; shrink+recenter to fit short viewports.
      // Order: title → score → distribution chart → comment input → comment button → try again.
      const GAP_TOP = 16, GAP_TITLE = 40, GAP_SCORE = 26;
      const CHART_H = 40, CHART_FOOT = 68, GAP_INPUT = 40, GAP_CBTN = 60, GAP_TRY = 48, GAP_BOTTOM = 16;
      const NOMINAL_H = GAP_TOP + GAP_TITLE + GAP_SCORE + CHART_H + CHART_FOOT + GAP_INPUT + GAP_CBTN + GAP_TRY + GAP_BOTTOM;
      const k = Math.max(0.55, Math.min(1, (this.H - 24) / NOMINAL_H));
      let y = Math.max(14, (this.H - NOMINAL_H * k) / 2);

      y += GAP_TOP * k;
      this.oText(cx, y, 'GAME OVER',
        { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68 * k), color: '#FF4444' });
      y += GAP_TITLE * k;
      this.oText(cx, y, `Score: ${score}`,
        { fontSize: fsz(S * 0.42 * k), color: '#FFD700' });

      const boardW = this.W - 2 * this.ox;
      y += GAP_SCORE * k;
      const chartTopY = y;
      const chartH = Math.max(24, CHART_H * k);
      const chartW = Math.min(boardW - 40, Math.max(200, boardW * 0.78));
      const loadingT = this.oText(cx, chartTopY + chartH / 2, 'Loading…',
        { fontSize: fsz(S * 0.24 * k), color: '#446644' });
      fetch('/api/submitScore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      }).then(r => r.json() as Promise<SubmitScoreResponse>)
        .then(d => {
          if (this.status !== 'game_over') return;
          loadingT.setVisible(false);
          this.drawDistChart(d, cx, chartTopY, chartW, chartH, k);
          const bits: string[] = [];
          if (d.streak !== undefined && d.streak > 0) bits.push(`🔥 ${d.streak}-day streak`);
          if (d.globalRank !== undefined) bits.push(`🌍 Global Rank ${d.globalRank}`);
          if (bits.length) {
            this.oText(cx, chartTopY + chartH + CHART_FOOT * k * 0.82, bits.join('    '),
              { fontFamily: 'Arial Black', fontSize: fsz(S * 0.3 * k), color: '#9fffc0', stroke: '#0d2b1a', strokeThickness: Math.max(2, 3 * k) });
          }
        })
        .catch(() => { if (loadingT.active) loadingT.setVisible(false); });

      y = chartTopY + chartH + CHART_FOOT * k + GAP_INPUT * k;
      const autoMsg = this.level === 0
        ? `I scored ${score} pts on Level 1 of today's Gardener's Gambit! 🌱`
        : `I reached Level ${this.level + 1} and scored ${score} pts on today's Gardener's Gambit! 🌱`;
      const inputW = Math.min(boardW - 36, Math.max(190, boardW * 0.6));
      const inputH = Math.max(44, Math.floor(58 * k));
      const inputEl = this.add.dom(cx, y, 'input',
        `width:${inputW}px;height:${inputH}px;font-size:${Math.max(11, Math.floor(13 * k))}px;padding:0 14px;box-sizing:border-box;` +
        'border:1px solid rgba(127,224,159,0.4);border-radius:10px;' +
        'background:#0d2b1a;color:#a0d0b0;outline:none;font-family:Arial;text-overflow:ellipsis;');
      const inp = inputEl.node as HTMLInputElement;
      inp.type = 'text'; inp.maxLength = 200;
      inp.placeholder = 'Add a note… (optional)';
      // Keep keystrokes (incl. Space, which Phaser captures) inside the input.
      for (const ev of ['keydown', 'keyup', 'keypress']) inp.addEventListener(ev, e => e.stopPropagation());
      inputEl.setDepth(4);
      this.overlayItems.push(inputEl);

      y += GAP_CBTN * k;
      const commentBtn = this.oBtn(cx, y, 'Comment My Score', '#FF8800', '#1A1A30', () => {
        const note = inp.value.trim();
        const text = note ? `${note}\n\n${autoMsg}` : autoMsg;
        commentBtn.setText('Posting...');
        fetch('/api/postComment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: text }),
        }).then(res => { if (!res.ok) throw new Error(); commentBtn.setText('Posted!'); })
          .catch(() => commentBtn.setText('Post failed'));
      }, k, inputW);

      y += GAP_TRY * k;
      this.oBtn(cx, y, 'Try Again', '#FF8888', '#3A0000', () => {
        this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
      }, k);

    } else if (this.testMode) {
      const GAP_TOP = 18, GAP_TITLE = 40, GAP_SCORE = 46, GAP_BTN1 = 54, GAP_BOTTOM = 20;
      const NOMINAL_H = GAP_TOP + GAP_TITLE + GAP_SCORE + GAP_BTN1 + GAP_BOTTOM;
      const k = Math.max(0.55, Math.min(1, (this.H - 24) / NOMINAL_H));
      let y = Math.max(14, (this.H - NOMINAL_H * k) / 2);

      y += GAP_TOP * k;
      this.oText(cx, y, 'GAME OVER',
        { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68 * k), color: '#FF4444' });
      y += GAP_TITLE * k;
      this.oText(cx, y, `Score: ${score}`,
        { fontSize: fsz(S * 0.42 * k), color: '#FFD700' });
      y += GAP_SCORE * k;
      this.oBtn(cx, y, 'Try Again', '#FF8888', '#3A0000', () => {
        this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
      }, k);
      y += GAP_BTN1 * k;
      this.oBtn(cx, y, 'Back to Editor', '#AAAAFF', '#1A1A3A', () => this.exitTestMode(), k);

    } else {
      const GAP_TOP = 16, GAP_TITLE = 40, GAP_SCORE = 26;
      const CHART_H = 40, CHART_FOOT = 68, GAP_INPUT = 40, GAP_CBTN = 60, GAP_TRY = 48, GAP_BOTTOM = 16;
      const NOMINAL_H = GAP_TOP + GAP_TITLE + GAP_SCORE + CHART_H + CHART_FOOT + GAP_INPUT + GAP_CBTN + GAP_TRY + GAP_BOTTOM;
      const k = Math.max(0.55, Math.min(1, (this.H - 24) / NOMINAL_H));
      let y = Math.max(14, (this.H - NOMINAL_H * k) / 2);

      y += GAP_TOP * k;
      this.oText(cx, y, 'GAME OVER',
        { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68 * k), color: '#FF4444' });
      y += GAP_TITLE * k;
      this.oText(cx, y, `Score: ${score}`,
        { fontSize: fsz(S * 0.42 * k), color: '#FFD700' });

      const boardW = this.W - 2 * this.ox;
      y += GAP_SCORE * k;
      const chartTopY = y;
      const chartH = Math.max(24, CHART_H * k);
      const chartW = Math.min(boardW - 40, Math.max(200, boardW * 0.78));
      const loadingT = this.oText(cx, chartTopY + chartH / 2, 'Loading…',
        { fontSize: fsz(S * 0.24 * k), color: '#446644' });
      fetch('/api/submitScore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      }).then(r => r.json() as Promise<SubmitScoreResponse>)
        .then(d => {
          if (this.status !== 'game_over') return;
          loadingT.setVisible(false);
          this.drawDistChart(d, cx, chartTopY, chartW, chartH, k);
          const bits: string[] = [];
          if (d.streak !== undefined && d.streak > 0) bits.push(`🔥 ${d.streak}-day streak`);
          if (d.globalRank !== undefined) bits.push(`🌍 Global Rank ${d.globalRank}`);
          if (bits.length) {
            this.oText(cx, chartTopY + chartH + CHART_FOOT * k * 0.82, bits.join('    '),
              { fontFamily: 'Arial Black', fontSize: fsz(S * 0.3 * k), color: '#9fffc0', stroke: '#0d2b1a', strokeThickness: Math.max(2, 3 * k) });
          }
        })
        .catch(() => { if (loadingT.active) loadingT.setVisible(false); });

      y = chartTopY + chartH + CHART_FOOT * k + GAP_INPUT * k;
      const autoMsg = this.level === 0
        ? `I scored ${score} pts on Level 1 of this Gardener's Gambit! 🌱`
        : `I reached Level ${this.level + 1} and scored ${score} pts on this Gardener's Gambit! 🌱`;
      const inputW = Math.min(boardW - 36, Math.max(190, boardW * 0.6));
      const inputH = Math.max(44, Math.floor(58 * k));
      const inputEl = this.add.dom(cx, y, 'input',
        `width:${inputW}px;height:${inputH}px;font-size:${Math.max(11, Math.floor(13 * k))}px;padding:0 14px;box-sizing:border-box;` +
        'border:1px solid rgba(127,224,159,0.4);border-radius:10px;' +
        'background:#0d2b1a;color:#a0d0b0;outline:none;font-family:Arial;text-overflow:ellipsis;');
      const inp = inputEl.node as HTMLInputElement;
      inp.type = 'text'; inp.maxLength = 200;
      inp.placeholder = 'Add a note… (optional)';
      // Keep keystrokes (incl. Space, which Phaser captures) inside the input.
      for (const ev of ['keydown', 'keyup', 'keypress']) inp.addEventListener(ev, e => e.stopPropagation());
      inputEl.setDepth(4);
      this.overlayItems.push(inputEl);

      y += GAP_CBTN * k;
      const commentBtn = this.oBtn(cx, y, 'Comment My Score', '#FF8800', '#1A1A30', () => {
        const note = inp.value.trim();
        const text = note ? `${note}\n\n${autoMsg}` : autoMsg;
        commentBtn.setText('Posting...');
        fetch('/api/postComment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: text }),
        }).then(res => { if (!res.ok) throw new Error(); commentBtn.setText('Posted!'); })
          .catch(() => commentBtn.setText('Post failed'));
      }, k, inputW);

      y += GAP_TRY * k;
      this.oBtn(cx, y, 'Try Again', '#FF8888', '#3A0000', () => {
        this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
      }, k);
    }
  }

  private showWin() {
    this.status = 'win';
    this.overlay(0.88);
    const cx = this.W / 2;
    const S = this.S;
    const fsz = (n: number) => `${Math.max(9, Math.floor(n))}px`;
    const score = this.score;
    const elapsed = this.elapsed;
    const daily = !this.isCustom; // daily mode gets the streak line + next-puzzle countdown

    const GAP_TOP = 16, GAP_TITLE = 50, GAP_SUB = 26, GAP_SCORE = 24, GAP_TIME = 30;
    const GAP_STREAK = daily ? 30 : 0;
    const BADGE_H = 94, GAP_BADGE = 30;
    const GAP_COUNT = daily ? 28 : 0;
    const GAP_BTN = 50, GAP_BOTTOM = 20;
    const NOMINAL_H = GAP_TOP + GAP_TITLE + GAP_SUB + GAP_SCORE + GAP_TIME + GAP_STREAK + BADGE_H + GAP_BADGE + GAP_COUNT + GAP_BTN + GAP_BOTTOM;
    const k = Math.max(0.55, Math.min(1, (this.H - 24) / NOMINAL_H));
    let y = Math.max(14, (this.H - NOMINAL_H * k) / 2);

    y += GAP_TOP * k;
    this.oText(cx, y, 'YOU WIN!',
      { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68 * k), color: '#FFD700' });
    y += GAP_TITLE * k;
    this.oText(cx, y, 'All foxes trapped!',
      { fontSize: fsz(S * 0.34 * k), color: '#AAFFAA' });
    y += GAP_SUB * k;
    this.oText(cx, y, `Final Score: ${score}`,
      { fontSize: fsz(S * 0.42 * k), color: '#FFFFFF' });
    y += GAP_SCORE * k;
    this.oText(cx, y, `Time: ${this.fmt(elapsed)}`,
      { fontSize: fsz(S * 0.30 * k), color: '#AAAAFF' });
    y += GAP_TIME * k;

    // Streak: value arrives with the submitScore response below; reserve the slot now, fill it in then.
    let streakText: Phaser.GameObjects.Text | undefined;
    if (daily) {
      streakText = this.oText(cx, y, '',
        { fontFamily: 'Arial Black', fontSize: fsz(S * 0.42 * k), color: '#FF9D3A', stroke: '#3a1a00', strokeThickness: Math.max(1, 3 * k) });
      y += GAP_STREAK * k;
    }

    const badgeY = y;
    const loadingT = this.oText(cx, badgeY + 20 * k, 'Loading…',
      { fontSize: fsz(S * 0.24 * k), color: '#446644' });
    fetch('/api/submitScore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    }).then(r => r.json() as Promise<SubmitScoreResponse>)
      .then(d => {
        if (this.status !== 'win') return;
        loadingT.setVisible(false);
        this.drawRankBadge(d, cx, badgeY, k);
        if (streakText && d.streak) streakText.setText(`🔥 ${d.streak}-day streak`);
      })
      .catch(() => { if (loadingT.active) loadingT.setVisible(false); });

    y += BADGE_H * k + GAP_BADGE * k;

    // Countdown to the next daily puzzle (cron drops it at 13:00 UTC) — live "come back" hook.
    if (daily) {
      const cd = this.oText(cx, y, `⏳ Next puzzle in ${this.fmtCountdown(this.msToNextDaily())}`,
        { fontSize: fsz(S * 0.30 * k), color: '#9fd4b0', stroke: '#0d2b1a', strokeThickness: Math.max(1, 2 * k) });
      this.countdownEvent = this.time.addEvent({
        delay: 1000, loop: true,
        callback: () => { if (cd.active) cd.setText(`⏳ Next puzzle in ${this.fmtCountdown(this.msToNextDaily())}`); },
      });
      y += GAP_COUNT * k;
    }

    const postBtn = this.oBtn(cx, y, 'Post Score to Reddit', '#FF8800', '#1A1A30', () => {
      postBtn.setText('Posting...');
      fetch('/api/postScore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, time: this.fmt(elapsed) }),
      }).then(res => { if (!res.ok) throw new Error(); postBtn.setText('Posted!'); })
        .catch(() => postBtn.setText('Post failed'));
    }, k);
    y += GAP_BTN * k;
    this.oBtn(cx, y, 'Play Again', '#88FF88', '#1A3A1A', () => {
      this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
    }, k);
  }

  // Histogram of scores over fixed 400-pt ranges (0-400, 401-800, …). Continuous x-axis:
  // empty ranges render as flat bars so the axis reads left-to-right; your range is gold
  // with a "You" marker. Footer shows the percentile ("Better than X% of players").
  private drawDistChart(data: SubmitScoreResponse, cx: number, topY: number, w: number, h: number, k = 1) {
    const { yourScore, rank, total, buckets } = data;
    const fsz = (n: number) => `${Math.max(8, Math.floor(n))}px`;
    const BUCKET = 400;

    if (!buckets.length) {
      this.oText(cx, topY + h / 2, 'No scores yet',
        { fontSize: fsz(this.S * 0.22 * k), color: '#7fe09f' });
      return;
    }

    const g = this.add.graphics().setDepth(4);
    this.overlayItems.push(g);

    const fmtK = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`;
    const maxCount = Math.max(...buckets.map(b => b.count), 1);
    const n = buckets.length;
    const maxBarW = Math.max(14, 34 * k);
    const bw = Math.min(maxBarW, Math.max(10, (w / n) * 0.5));
    let gap = n > 1 ? (w - bw * n) / (n - 1) : 0;
    gap = Math.max(4, Math.min(gap, 64 * k));
    const groupW = bw * n + gap * (n - 1);
    const x0 = cx - groupW / 2;
    const pitch = bw + gap;
    const padTop = 12 * k;
    const barMaxH = Math.max(6, h - padTop);
    const barBottom = topY + h;

    const yourIdx = buckets.findIndex((b, i) => {
      const nextMin = buckets[i + 1]?.min ?? Infinity;
      return yourScore >= b.min && yourScore < nextMin;
    });

    // Axis baseline
    g.fillStyle(0x5a8a68, 0.5);
    g.fillRect(x0 - gap / 2, barBottom, groupW + gap, Math.max(1, k));

    for (let i = 0; i < n; i++) {
      const b = buckets[i]!;
      const isYours = i === yourIdx;
      const bh = b.count > 0 ? Math.max(3, (b.count / maxCount) * barMaxH) : Math.max(2, 2 * k);
      const bx = x0 + i * pitch;
      g.fillStyle(isYours ? 0xFFD700 : 0x3dbd60, b.count > 0 ? (isYours ? 1 : 0.7) : 0.25);
      g.fillRoundedRect(bx, barBottom - bh, bw, bh, Math.min(3, bw / 3));

      if (b.count > 0) {
        this.oText(bx + bw / 2, barBottom - bh - 7 * k, `${b.count}`,
          { fontSize: fsz(9 * k), color: isYours ? '#FFD700' : '#7fe09f' });
      }
      // Boundary tick at each bar's left edge
      this.oText(bx, barBottom + 9 * k, fmtK(b.min),
        { fontSize: fsz(9.5 * k), color: '#9fd4b0', stroke: '#0d2b1a', strokeThickness: Math.max(1, 2 * k) });
      if (isYours) {
        this.oText(bx + bw / 2, barBottom + 20 * k, 'You',
          { fontFamily: 'Arial Black', fontSize: fsz(9 * k), color: '#FFD700', stroke: '#0d2b1a', strokeThickness: Math.max(1, 2 * k) });
      }
    }
    // Final upper-bound tick at right edge
    const last = buckets[n - 1]!;
    this.oText(x0 + groupW, barBottom + 9 * k, last.overflow ? `${fmtK(last.min)}+` : fmtK(last.min + BUCKET),
      { fontSize: fsz(9.5 * k), color: '#9fd4b0', stroke: '#0d2b1a', strokeThickness: Math.max(1, 2 * k) });

    if (total > 1) {
      this.oText(cx, barBottom + 36 * k, `Better than ${Math.round(((total - rank) / (total - 1)) * 100)}% of players`,
        { fontSize: fsz(this.S * 0.26 * k), color: '#AAFFAA', stroke: '#0d2b1a', strokeThickness: Math.max(1, 2 * k) });
    }
  }

  private drawRankBadge(data: SubmitScoreResponse, cx: number, topY: number, k = 1) {
    const { rank, total } = data;
    const r = Math.max(18, 28 * k);
    const badgeColor = rank <= 3 ? 0xFFD700 : rank <= 10 ? 0xC0C0C0 : 0x3dbd60;
    const textColor = rank <= 3 ? '#FFD700' : rank <= 10 ? '#C0C0C0' : '#3dbd60';

    const g = this.add.graphics().setDepth(4);
    this.overlayItems.push(g);

    // Outer glow ring
    g.lineStyle(3, badgeColor, 0.3);
    g.strokeCircle(cx, topY + r, r + 6);
    // Badge circle
    g.fillStyle(0x0d2b1a, 1);
    g.fillCircle(cx, topY + r, r);
    g.lineStyle(2, badgeColor, 1);
    g.strokeCircle(cx, topY + r, r);

    // Rank number inside circle
    this.oText(cx, topY + r, `#${rank}`, {
      fontFamily: 'Arial Black', fontSize: `${Math.max(12, Math.floor(r * 0.85))}px`, color: textColor,
    });

    // "of N players" below badge
    this.oText(cx, topY + r * 2 + 10 * k, `of ${total} player${total !== 1 ? 's' : ''}`, {
      fontSize: `${Math.max(9, Math.floor(12 * k))}px`, color: '#7fe09f',
    });

    // Percentile
    const pct = total > 1 ? Math.max(1, Math.round(((total - rank) / total) * 100)) : 100;
    this.oText(cx, topY + r * 2 + 28 * k, `Top ${pct}%`, {
      fontFamily: 'Arial Black', fontSize: `${Math.max(10, Math.floor(13 * k))}px`, color: textColor,
    });
  }

  private floatPoints(c: number, r: number, txt: string, color: string) {
    const startY = this.cy(r);
    const t = this.add.text(this.cx(c), startY, txt, {
      fontFamily: 'Arial Black', fontSize: `${Math.max(12, Math.floor(this.S * 0.42))}px`,
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(5);
    this.tweens.add({
      targets: t, y: startY - this.S * 1.3, alpha: 0,
      duration: 850, ease: 'Cubic.Out', onComplete: () => t.destroy(),
    });
  }

  private fmt(sec: number): string {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ms until the next daily puzzle drops (scheduler cron is 13:00 UTC — see devvit.json).
  private msToNextDaily(): number {
    const now = Date.now();
    const next = new Date(now);
    next.setUTCHours(13, 0, 0, 0);
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now;
  }

  private fmtCountdown(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m ${ss.toString().padStart(2, '0')}s`;
  }

  // ── MAIN LOOP ─────────────────────────────────────────────────────────────

  override update(_time: number, delta: number) {
    if (this.status !== 'playing') return;

    this.elapsed += delta / 1000;
    this.timerText?.setText(this.fmt(this.elapsed));

    this.foxTimer += delta;
    if (this.foxTimer >= FOX_SPEEDS[this.level]!) {
      this.foxTimer = 0;
      this.moveFoxes();
      if (this.status !== 'playing') return;
    }

    if (this.moveCooldown > 0) { this.moveCooldown -= delta; return; }
    const c = this.cursors;
    if (c.left?.isDown)  { this.tryMove({ dr: 0, dc: -1 }); this.moveCooldown = 150; }
    else if (c.right?.isDown) { this.tryMove({ dr: 0, dc: 1 });  this.moveCooldown = 150; }
    else if (c.up?.isDown)    { this.tryMove({ dr: -1, dc: 0 }); this.moveCooldown = 150; }
    else if (c.down?.isDown)  { this.tryMove({ dr: 1, dc: 0 });  this.moveCooldown = 150; }
  }
}
