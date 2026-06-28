import { Scene } from 'phaser';

// Shared skin definitions + texture generation, used by both Editor and Game.
// Gardener skin 0 and fox skin 0 use generated textures here; fox skin 0 in play
// falls back to the 'fox' PNG (see foxKey).
export const GARDENER_SKINS = [
  { name: 'Gardener', c: 0xff4500 }, { name: 'Mia', c: 0xe88c8c }, { name: 'Sam', c: 0x4aa3df },
  { name: 'Trump', c: 0xe3b23c }, { name: 'Putin', c: 0x9aa0a6 },
];
export const FOX_SKINS = [
  { name: 'Fox', c: 0xe8731c }, { name: 'Arctic Fox', c: 0xe3e8f0 }, { name: 'Shadow Fox', c: 0x3a3a4a },
  { name: 'Trump', c: 0xe3b23c }, { name: 'Putin', c: 0x6b7a8f },
];

export const foxKey = (i: number) => (i === 0 ? 'fox' : `fox_${i}`); // skin 0 uses the real PNG

// Strip white bg, autocrop, cover-scale to 64×64. srcKey→dstKey (same key = in-place replace).
export function processTexture(scene: Scene, srcKey: string, dstKey: string) {
  if (!scene.textures.exists(srcKey)) return;
  if (dstKey !== srcKey && scene.textures.exists(dstKey)) return;
  const src = scene.textures.get(srcKey).getSourceImage() as HTMLImageElement;
  const T = 64, INTER = 256;
  const tmp = document.createElement('canvas');
  tmp.width = INTER; tmp.height = INTER;
  const tCtx = tmp.getContext('2d')!;
  tCtx.drawImage(src, 0, 0, INTER, INTER);
  const id = tCtx.getImageData(0, 0, INTER, INTER).data;
  let x0 = INTER, y0 = INTER, x1 = 0, y1 = 0;
  for (let y = 0; y < INTER; y++) {
    for (let x = 0; x < INTER; x++) {
      const i = (y * INTER + x) * 4;
      if (id[i + 3] > 16 && !(id[i] > 240 && id[i + 1] > 240 && id[i + 2] > 240)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = T; canvas.height = T;
  const ctx = canvas.getContext('2d')!;
  if (x1 > x0 && y1 > y0) {
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const scale = Math.min(T / cw, T / ch);
    const dw = cw * scale, dh = ch * scale;
    ctx.drawImage(tmp, x0, y0, cw, ch, (T - dw) / 2, (T - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(src, 0, 0, T, T);
  }
  const od = ctx.getImageData(0, 0, T, T);
  const d = od.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) d[i + 3] = 0;
  }
  ctx.putImageData(od, 0, 0);
  if (dstKey === srcKey) scene.textures.remove(srcKey);
  scene.textures.addCanvas(dstKey, canvas);
}

export function makeSkinTextures(scene: Scene) {
  const T = 64;
  const draw = (key: string, fn: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }); fn(g); g.generateTexture(key, T, T); g.destroy();
  };
  const composite = (key: string, rawKey: string) => processTexture(scene, rawKey, key);
  GARDENER_SKINS.forEach((s, i) => {
    const key = `gard_${i}`;
    const rawKey = `gard_raw_${i}`;
    if (i > 0 && scene.textures.exists(rawKey)) {
      composite(key, rawKey);
    } else {
      draw(key, (g) => {
        g.fillStyle(s.c); g.fillRoundedRect(19, 33, 26, 27, 7);
        g.fillStyle(0xf1c27d); g.fillCircle(32, 28, 11);
        g.fillStyle(0x6b4a2a); g.fillEllipse(32, 20, 36, 11);
        g.fillStyle(0x3a2a12); g.fillCircle(28, 28, 2); g.fillCircle(36, 28, 2);
      });
    }
  });
  FOX_SKINS.forEach((s, i) => {
    const key = foxKey(i);
    const rawKey = `fox_raw_${i}`;
    if (i > 0 && scene.textures.exists(rawKey)) {
      composite(key, rawKey);
    } else if (i > 0) {
      draw(key, (g) => {
        g.fillStyle(s.c); g.fillTriangle(14, 50, 32, 14, 50, 50);
        g.fillStyle(s.c); g.fillTriangle(14, 26, 18, 6, 28, 22); g.fillTriangle(50, 26, 46, 6, 36, 22);
        g.fillStyle(0xfff1dd); g.fillTriangle(24, 48, 32, 28, 40, 48);
        g.fillStyle(0x2a1a0a); g.fillCircle(26, 30, 2.4); g.fillCircle(38, 30, 2.4); g.fillTriangle(29, 41, 35, 41, 32, 46);
      });
    }
  });
}
