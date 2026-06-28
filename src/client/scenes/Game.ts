import { Scene } from 'phaser';
import levels from '../levels.json';
import { foxKey, makeSkinTextures } from '../skins';
import type { SubmitScoreResponse } from '../../shared/api';

// 0=fence 1=soil 2=hedge(grass, pushable) 3=gardener 4=fox 5=pumpkin 6=corn
// Grid: 23×23 — fence ring, 3-thick soil ring (fox zone), 15×15 grass centre, gardener mid.
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
  private puzzleNumber?: number;
  private customMapTitle?: string;

  constructor() { super('Game'); }

  init(data?: { customMap?: number[][]; testMode?: boolean; isCustom?: boolean; gardenerSkin?: number; foxSkin?: number; puzzleNumber?: number; customMapTitle?: string }) {
    this.testMode = data?.testMode ?? false;
    this.isCustom = data?.isCustom ?? false;
    this.customMap = data?.customMap ? data.customMap.map(r => r.slice()) : null;
    this.gardenerSkin = data?.gardenerSkin ?? 0;
    this.foxSkin = data?.foxSkin ?? 0;
    this.puzzleNumber = data?.puzzleNumber;
    this.customMapTitle = data?.customMapTitle;
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
    this.makeTextures();
    if (this.testMode || this.isCustom) makeSkinTextures(this);
    this.initLevel();
  }

  // Crisp vector sprites generated at 64px, drawn over the unclear PNGs.
  private makeTextures() {
    const T = 64;
    const draw = (key: string, fn: (g: Phaser.GameObjects.Graphics) => void) => {
      if (this.textures.exists(key)) this.textures.remove(key);
      const g = this.make.graphics({ x: 0, y: 0 });
      fn(g);
      g.generateTexture(key, T, T);
      g.destroy();
    };

    draw('gfx_gardener', (g) => {
      g.fillStyle(0x2E7D32); g.fillRoundedRect(19, 33, 26, 27, 7);   // green overalls
      g.fillStyle(0xF1C27D); g.fillCircle(32, 28, 11);                // face
      g.fillStyle(0xE3B23C); g.fillEllipse(32, 20, 38, 12);           // straw hat brim
      g.fillStyle(0xE3B23C); g.fillRoundedRect(24, 8, 16, 14, 4);     // hat top
      g.fillStyle(0x3A2A12); g.fillCircle(28, 28, 2); g.fillCircle(36, 28, 2);
    });

    draw('gfx_fox', (g) => {
      g.fillStyle(0xE8731C); g.fillTriangle(14, 50, 32, 14, 50, 50);  // head
      g.fillStyle(0xE8731C); g.fillTriangle(14, 26, 18, 6, 28, 22);   // ears
      g.fillStyle(0xE8731C); g.fillTriangle(50, 26, 46, 6, 36, 22);
      g.fillStyle(0xFFF1DD); g.fillTriangle(24, 48, 32, 28, 40, 48);  // muzzle
      g.fillStyle(0x2A1A0A); g.fillCircle(26, 30, 2.4); g.fillCircle(38, 30, 2.4);
      g.fillStyle(0x2A1A0A); g.fillTriangle(29, 41, 35, 41, 32, 46);  // nose
    });

    draw('gfx_pumpkin', (g) => {
      g.fillStyle(0xE8731C); g.fillEllipse(32, 39, 42, 36);
      g.fillStyle(0xCF6314); g.fillEllipse(20, 39, 10, 30); g.fillEllipse(44, 39, 10, 30);
      g.fillStyle(0xF5862A); g.fillEllipse(32, 39, 12, 34);
      g.fillStyle(0x3A7D2C); g.fillRect(29, 15, 6, 10);
    });

    draw('gfx_corn', (g) => {
      g.fillStyle(0x4C9A2A); g.fillTriangle(18, 32, 32, 18, 30, 52); g.fillTriangle(46, 32, 32, 18, 34, 52);
      g.fillStyle(0xF2C200); g.fillEllipse(32, 40, 20, 40);
      g.fillStyle(0xD9A400);
      for (let yy = 26; yy <= 52; yy += 6) for (let xx = 26; xx <= 38; xx += 6) g.fillCircle(xx, yy, 1.5);
    });
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
    const raw = ((this.testMode || this.isCustom) && this.customMap) ? this.customMap : MAPS[gameIdx * 3 + this.level];
    this.initMapData = raw;
    this.nr = raw.length;
    this.nc = raw[0]!.length;
    this.grid = raw.map(row => [...row]);
    this.gardener = { r: 0, c: 0 };
    this.foxes = [];
    this.veggies = [];

    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) {
        const t = this.grid[r][c];
        if (t === 3) { this.gardener = { r, c }; this.grid[r][c] = 1; }
        else if (t === 4) { this.foxes.push({ r, c, alive: true, sprite: null }); this.grid[r][c] = 1; }
        else if (t === 5) { this.veggies.push({ r, c, type: 'pumpkin', eaten: false, sprite: null }); this.grid[r][c] = 1; }
        else if (t === 6) { this.veggies.push({ r, c, type: 'corn', eaten: false, sprite: null }); this.grid[r][c] = 1; }
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
      let h = Math.imul(r * 374761393 + c * 668265263, 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
    };

    this.animGrassCells = [];
    const animSet = new Set<string>();
    for (let r = 1; r < this.nr - 1; r++) {
      for (let c = 1; c < this.nc - 1; c++) {
        const x = fx + FENCE_PX + (c - 1) * S, y = fy + FENCE_PX + (r - 1) * S;
        const t = this.grid[r][c];
        if (t === 1) {
          g.fillStyle(0xCBA877); g.fillRect(x, y, S, S);
        } else if (t === 7) {
          g.fillStyle(0xCBA877); g.fillRect(x, y, S, S);
          g.fillStyle(0x5F6266); g.fillRoundedRect(x + 2, y + 2, S - 4, S - 4, Math.max(2, S / 6));
          g.fillStyle(0x8A8D91); g.fillRoundedRect(x + 3, y + 3, S - 7, S - 7, Math.max(2, S / 6));
        } else {
          g.fillStyle(0x163208); g.fillRect(x, y, S, S);
          g.fillStyle(0x3C8E2C); g.fillRect(x + 1, y + 1, S - 2, S - 2);
          const lp = Math.max(2, Math.floor(S / 4));
          g.fillStyle(0x73C94E);
          g.fillRect(x + lp, y + lp, lp, lp);
          g.fillRect(x + lp * 2, y + lp * 2, lp, lp);
          g.fillRect(x + 2, y + lp * 2, lp, lp);
          g.fillRect(x + lp * 2, y + 2, lp, lp);
          // ~10% of grass cells animate; skip if a diagonal neighbour is already selected
          if (rng(r, c) < 0.10) {
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
    const mw = Math.max(1, Math.floor(S * 0.3));
    const sh = this.grassFrame === 0 ? 0 : Math.floor(S * 0.13);
    ag.fillStyle(0x8fe060, 0.8);
    for (const { r, c } of this.animGrassCells) {
      const x = this.ox + FENCE_PX + (c - 1) * S;
      const y = this.oy + FENCE_PX + (r - 1) * S;
      ag.fillRect(x + 2 + sh, y + Math.floor(S * 0.28), mw, 1);
      ag.fillRect(x + Math.floor(S * 0.45) + sh, y + Math.floor(S * 0.62), mw, 1);
    }
  }

  private buildSprites() {
    const S = this.S;
    const skinned = this.testMode || this.isCustom;
    const gKey = skinned ? `gard_${this.gardenerSkin}` : 'gfx_gardener';
    const fKey = skinned ? foxKey(this.foxSkin) : 'gfx_fox';
    this.gardenerSprite = this.add.image(this.cx(this.gardener.c), this.cy(this.gardener.r), gKey)
      .setDisplaySize(S * 1.1, S * 1.1).setDepth(1);

    for (const fox of this.foxes) {
      fox.sprite = this.add.image(this.cx(fox.c), this.cy(fox.r), fKey)
        .setDisplaySize(S * 0.9, S * 0.9).setDepth(1);
    }
    for (const v of this.veggies) {
      const vKey = skinned ? v.type : `gfx_${v.type}`;
      v.sprite = this.add.image(this.cx(v.c), this.cy(v.r), vKey)
        .setDisplaySize(S * 0.82, S * 0.82).setDepth(1);
    }
  }

  private buildHUD() {
    const fs = (n: number) => `${Math.max(11, Math.floor(n))}px`;
    const S = this.S;
    const heartSize = Math.max(18, Math.floor(S * 0.55));
    const fh = (this.nr - 2) * S + 2 * FENCE_PX;
    const gridMidY = this.oy + fh / 2;

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
    const t = this.grid[nr][nc];
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
    while (r >= 0 && r < this.nr && c >= 0 && c < this.nc && this.grid[r][c] === 2) {
      chain.push({ r, c }); r += dr; c += dc;
    }
    if (r < 0 || r >= this.nr || c < 0 || c >= this.nc) return false;
    if (this.grid[r][c] === 0 || this.grid[r][c] === 7) return false; // can't push into fence/rock
    if (this.foxes.some(f => f.alive && f.r === r && f.c === c)) return false;

    for (let i = chain.length - 1; i >= 0; i--) {
      const h = chain[i];
      this.grid[h.r + dr][h.c + dc] = 2;
      this.grid[h.r][h.c] = 1;
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
        if (this.grid[nr][nc] === 0 || this.grid[nr][nc] === 2 || this.grid[nr][nc] === 7) return true;
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
    visited[fox.r][fox.c] = true;
    const queue: Pos[] = [{ r: fox.r, c: fox.c }];

    outer: while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const { dr, dc } of DIRS8) {
        const nr = curr.r + dr, nc = curr.c + dc;
        if (nr < 0 || nr >= this.nr || nc < 0 || nc >= this.nc) continue;
        if (visited[nr][nc]) continue;
        if (this.grid[nr][nc] === 0 || this.grid[nr][nc] === 2 || this.grid[nr][nc] === 7) continue;
        if (this.foxes.some(f => f !== fox && f.alive && f.r === nr && f.c === nc)) continue;
        visited[nr][nc] = true;
        parent[nr][nc] = curr;
        if (nr === target.r && nc === target.c) break outer;
        queue.push({ r: nr, c: nc });
      }
    }

    if (visited[target.r][target.c]) {
      // Trace back path to find first step
      let pos: Pos = target;
      while (parent[pos.r][pos.c] &&
             (parent[pos.r][pos.c]!.r !== fox.r || parent[pos.r][pos.c]!.c !== fox.c)) {
        pos = parent[pos.r][pos.c]!;
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
      if (this.grid[nr][nc] === 0 || this.grid[nr][nc] === 2 || this.grid[nr][nc] === 7) continue;
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

  private oBtn(x: number, y: number, txt: string, color: string, bg: string, cb: () => void) {
    const btn = this.add.text(x, y, txt, {
      fontFamily: 'Arial Black', fontSize: `${Math.max(14, Math.floor(this.S * 0.4))}px`,
      color, backgroundColor: bg, padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setDepth(4).setInteractive({ useHandCursor: true });
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
    const cx = this.W / 2, cy = this.H / 2;
    const S = this.S;
    const fsz = (n: number) => `${Math.max(11, Math.floor(n))}px`;
    const isDaily = !this.testMode && !this.isCustom;
    const score = this.score;

    if (isDaily) {
      // Title + score (compact)
      this.oText(cx, cy - 118, 'GAME OVER',
        { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68), color: '#FF4444' });
      this.oText(cx, cy - 68, `Score: ${score}`,
        { fontSize: fsz(S * 0.42), color: '#FFD700' });

      // Comment section — styled to match overlay
      this.oText(cx, cy - 38, 'Leave a comment:',
        { fontSize: fsz(S * 0.26), color: '#a0d0b0' });
      const defaultComment = this.level === 0
        ? `I scored ${score} pts on Level 1 of today's Gardener's Gambit! 🌱`
        : `I reached Level ${this.level + 1} and scored ${score} pts on today's Gardener's Gambit! 🌱`;
      const inputEl = this.add.dom(cx, cy - 12, 'input',
        'width:230px;height:26px;font-size:12px;padding:0 8px;' +
        'border:1px solid rgba(127,224,159,0.4);border-radius:6px;' +
        'background:#0d2b1a;color:#a0d0b0;outline:none;font-family:Arial;');
      const inp = inputEl.node as HTMLInputElement;
      inp.type = 'text'; inp.maxLength = 200; inp.value = defaultComment;
      inputEl.setDepth(4);
      this.overlayItems.push(inputEl);
      const commentBtn = this.oBtn(cx, cy + 26, 'Comment my Score', '#FF8800', '#1A1A30', () => {
        const text = inp.value.trim() || defaultComment;
        commentBtn.setText('Posting...');
        fetch('/api/postComment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: text }),
        }).then(res => { if (!res.ok) throw new Error(); commentBtn.setText('Posted!'); })
          .catch(() => commentBtn.setText('Post failed'));
      });

      // Chart — leave 26px gap above for "You ▼" label
      const chartTopY = cy + 68;
      const chartH = 36;
      const chartW = this.W * 0.65;
      const loadingT = this.oText(cx, chartTopY + chartH / 2, 'Loading…',
        { fontSize: fsz(S * 0.24), color: '#446644' });
      fetch('/api/submitScore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      }).then(r => r.json() as Promise<SubmitScoreResponse>)
        .then(d => { if (this.status !== 'game_over') return; loadingT.setVisible(false); this.drawDistChart(d, cx, chartTopY, chartW, chartH); })
        .catch(() => { if (loadingT.active) loadingT.setVisible(false); });

      this.oBtn(cx, chartTopY + chartH + 20, 'Try Again', '#FF8888', '#3A0000', () => {
        this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
      });

    } else {
      this.oText(cx, cy - 80, 'GAME OVER',
        { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68), color: '#FF4444' });
      this.oText(cx, cy - 28, `Score: ${score}`,
        { fontSize: fsz(S * 0.42), color: '#FFD700' });

      if (this.testMode) {
        this.oBtn(cx, cy + 32, 'Try Again', '#FF8888', '#3A0000', () => {
          this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
        });
        this.oBtn(cx, cy + 86, 'Back to Editor', '#AAAAFF', '#1A1A3A', () => this.exitTestMode());
      } else {
        const chartTopY = cy + 10;
        const chartH = 36;
        const chartW = this.W * 0.65;
        const loadingT = this.oText(cx, chartTopY + chartH / 2, 'Loading…',
          { fontSize: fsz(S * 0.24), color: '#446644' });
        fetch('/api/submitScore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score }),
        }).then(r => r.json() as Promise<SubmitScoreResponse>)
          .then(d => { if (this.status !== 'game_over') return; loadingT.setVisible(false); this.drawDistChart(d, cx, chartTopY, chartW, chartH); })
          .catch(() => { if (loadingT.active) loadingT.setVisible(false); });
        this.oBtn(cx, chartTopY + chartH + 20, 'Try Again', '#FF8888', '#3A0000', () => {
          this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
        });
      }
    }
  }

  private showWin() {
    this.status = 'win';
    this.overlay(0.88);
    const cx = this.W / 2, cy = this.H / 2;
    const S = this.S;
    const fsz = (n: number) => `${Math.max(11, Math.floor(n))}px`;
    const score = this.score;
    const elapsed = this.elapsed;

    this.oText(cx, cy - 112, 'YOU WIN!',
      { fontFamily: 'Arial Black', fontSize: fsz(S * 0.68), color: '#FFD700' });
    this.oText(cx, cy - 62, 'All foxes trapped!',
      { fontSize: fsz(S * 0.34), color: '#AAFFAA' });
    this.oText(cx, cy - 36, `Final Score: ${score}`,
      { fontSize: fsz(S * 0.42), color: '#FFFFFF' });
    this.oText(cx, cy - 12, `Time: ${this.fmt(elapsed)}`,
      { fontSize: fsz(S * 0.30), color: '#AAAAFF' });

    const badgeY = cy + 14;
    const loadingT = this.oText(cx, badgeY + 20, 'Loading…',
      { fontSize: fsz(S * 0.24), color: '#446644' });
    fetch('/api/submitScore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    }).then(r => r.json() as Promise<SubmitScoreResponse>)
      .then(d => { if (this.status !== 'win') return; loadingT.setVisible(false); this.drawRankBadge(d, cx, badgeY); })
      .catch(() => { if (loadingT.active) loadingT.setVisible(false); });

    const btnY = badgeY + 112;
    const postBtn = this.oBtn(cx, btnY, 'Post Score to Reddit', '#FF8800', '#1A1A30', () => {
      postBtn.setText('Posting...');
      fetch('/api/postScore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, time: this.fmt(elapsed) }),
      }).then(res => { if (!res.ok) throw new Error(); postBtn.setText('Posted!'); })
        .catch(() => postBtn.setText('Post failed'));
    });
    this.oBtn(cx, btnY + 50, 'Play Again', '#88FF88', '#1A3A1A', () => {
      this.lives = 3; this.score = 0; this.level = 0; this.initLevel();
    });
  }

  private drawRankBadge(data: SubmitScoreResponse, cx: number, topY: number) {
    const { rank, total } = data;
    const r = 28;
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
      fontFamily: 'Arial Black', fontSize: `${Math.max(14, r)}px`, color: textColor,
    });

    // "of N players" below badge
    this.oText(cx, topY + r * 2 + 10, `of ${total} player${total !== 1 ? 's' : ''}`, {
      fontSize: '12px', color: '#7fe09f',
    });

    // Percentile
    const pct = total > 1 ? Math.max(1, Math.round(((total - rank) / total) * 100)) : 100;
    this.oText(cx, topY + r * 2 + 28, `Top ${pct}%`, {
      fontFamily: 'Arial Black', fontSize: '13px', color: textColor,
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

  // ── MAIN LOOP ─────────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.status !== 'playing') return;

    this.elapsed += delta / 1000;
    this.timerText?.setText(this.fmt(this.elapsed));

    this.foxTimer += delta;
    if (this.foxTimer >= FOX_SPEEDS[this.level]) {
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
