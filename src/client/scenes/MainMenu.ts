import { Scene, GameObjects } from 'phaser';

export class MainMenu extends Scene {
  private title: GameObjects.Text | null = null;
  private subtitle: GameObjects.Text | null = null;
  private playBtn: GameObjects.Text | null = null;
  private createBtn: GameObjects.Text | null = null;
  private bgG: GameObjects.Graphics | null = null;

  constructor() { super('MainMenu'); }

  init(): void {
    this.title = null; this.subtitle = null;
    this.playBtn = null; this.createBtn = null;
    this.bgG = null;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0d2b1a);
    this.refreshLayout();
    this.scale.on('resize', () => this.refreshLayout());
  }

  private mkButton(label: string, color: number, onClick: () => void): GameObjects.Text {
    const b = this.add.text(0, 0, label, {
      fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff',
      backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
      padding: { x: 28, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    b.on('pointerover', () => b.setAlpha(0.85));
    b.on('pointerout', () => b.setAlpha(1));
    b.on('pointerdown', onClick);
    return b;
  }

  private refreshLayout(): void {
    const { width: W, height: H } = this.scale;
    this.cameras.resize(W, H);

    // Background gradient
    if (!this.bgG) this.bgG = this.add.graphics().setDepth(0);
    this.bgG!.clear();
    this.bgG!.fillGradientStyle(0x0d2b1a, 0x0d2b1a, 0x1a5c30, 0x1a5c30, 1);
    this.bgG!.fillRect(0, 0, W, H);

    // Title
    if (!this.title) {
      this.title = this.add.text(0, 0, "Gardener's Gambit", {
        fontFamily: 'Arial Black', fontSize: '36px', color: '#7fe09f',
        stroke: '#0a1f12', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(1);
    }
    this.title!.setPosition(W / 2, H * 0.32);

    if (!this.subtitle) {
      this.subtitle = this.add.text(0, 0, 'Trap the fox. Save the garden.', {
        fontFamily: 'Arial', fontSize: '16px', color: '#a0d0b0',
      }).setOrigin(0.5).setDepth(1);
    }
    this.subtitle!.setPosition(W / 2, H * 0.44);

    if (!this.playBtn) this.playBtn = this.mkButton('Play', 0x1a6b2a, () => this.scene.start('Game'));
    this.playBtn!.setPosition(W / 2, H * 0.60).setDepth(1);

    if (!this.createBtn) this.createBtn = this.mkButton('Create', 0x1a3a6b, () => {
      localStorage.setItem('gg_intent', 'create');
      this.scene.start('Editor');
    });
    this.createBtn!.setPosition(W / 2, H * 0.73).setDepth(1);
  }
}
