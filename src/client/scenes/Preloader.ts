import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import type { InitResponse } from '../../shared/api';
import { processTexture, trimTexture } from '../skins';

export class Preloader extends Scene {
  private initPromise: Promise<InitResponse | null> | null = null;

  constructor() {
    super('Preloader');
  }

  init() {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width * 0.6, 8).setStrokeStyle(1, 0x4a7c2f);
    const bar = this.add.rectangle(width * 0.2, height / 2, 4, 6, 0x4a7c2f);

    this.add.text(width / 2, height / 2 - 28, "Gardener's Gambit", {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff',
    }).setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      bar.width = 4 + width * 0.6 * p;
    });
  }

  preload() {
    // Start init fetch in parallel with asset loading
    this.initPromise = fetch('/api/init')
      .then(r => r.json() as Promise<InitResponse>)
      .catch(() => null);

    this.load.setPath('../assets');
    this.load.audio('bgmusic', 'music.mp3');
    this.load.image('pumpkin',  'pumpkin.png');
    this.load.image('corn',     'corn.png');
    this.load.image('fox',      'fox1.png');
    this.load.image('fox_raw_1', 'fox2.png');
    this.load.image('fox_raw_2', 'fox3.png');
    this.load.image('gard_raw_1', 'mia.png');
    this.load.image('gard_raw_2', 'sam.png');
  }

  async create() {
    let intent: string | null = null;
    try { intent = localStorage.getItem('gg_intent'); localStorage.removeItem('gg_intent'); } catch { /* ignore */ }

    const data = await this.initPromise;

    // Start background music (persists across scene transitions via global sound manager)
    if (!this.sound.get('bgmusic')) {
      const music = this.sound.add('bgmusic', { loop: true, volume: 0.20 });
      this.sound.mute = localStorage.getItem('gg_mute') === '1';
      try { music.play(); } catch { /* autoplay blocked; user interaction will unblock */ }
    }

    // Fix white bg on veggie sprites
    processTexture(this, 'corn', 'corn');
    processTexture(this, 'pumpkin', 'pumpkin');

    // Fox skin 0 (fox1.png): crop transparent padding at native res so it fills the cell, no quality loss
    trimTexture(this, 'fox');

    // Load snoovatar (or default snoo) as gard_0 for the username gardener skin
    const snooUrl = data?.snoovatarUrl ?? '/snoo.png';
    if (!this.textures.exists('gard_0')) {
      await new Promise<void>(r => {
        this.load.image('gard_0', snooUrl);
        this.load.once('complete', () => r());
        this.load.once('loaderror', () => r());
        this.load.start();
      });
    }
    // Snoovatar: crop transparent padding at native res (no-op for a cross-origin CDN snoovatar — tainted
    // canvas). The global pixelArt config draws every texture with nearest-neighbour, which turns this
    // smooth photo blocky; give just this texture LINEAR filtering so the Canvas renderer smooth-scales
    // it (SetTransform sets imageSmoothingEnabled from the frame's scaleMode) — crisp like the splash.
    trimTexture(this, 'gard_0');
    if (this.textures.exists('gard_0')) this.textures.get('gard_0').setFilter(Phaser.Textures.FilterMode.LINEAR);

    if (intent === 'create') {
      this.scene.start('Editor', {
        username: data?.username ?? '',
        unlockedGardener: data?.unlockedGardener,
        unlockedFox: data?.unlockedFox,
      });
      return;
    }

    if (intent === 'play') {
      if (data?.customMap?.grid) {
        this.scene.start('Game', {
          customMap: data.customMap.grid,
          isCustom: true,
          gardenerSkin: data.customMap.gardenerSkin ?? 0,
          foxSkin: data.customMap.foxSkin ?? 0,
          puzzleNumber: data.puzzleNumber,
          customMapTitle: data.customMap.title,
        });
        return;
      }
      this.scene.start('Game', { puzzleNumber: data?.puzzleNumber });
      return;
    }

    this.scene.start('MainMenu');
  }
}
