import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import { Editor } from './scenes/Editor';
import * as Phaser from 'phaser';
import { CANVAS, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';


//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: CANVAS,
  parent: 'game-container',
  backgroundColor: '#111111',
  pixelArt: true,      // nearest-neighbour filtering — crisp downscaled sprites
  roundPixels: true,   // no sub-pixel sprite positions
  dom: { createContainer: true }, // HTML number inputs in the editor
  render: {
    transparent: false,
    premultipliedAlpha: false,
    antialias: false,
    antialiasGL: false,
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [Boot, Preloader, MainMenu, MainGame, Editor, GameOver],
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

function boot() {
  StartGame('game-container');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
