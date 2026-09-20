import { Game } from './game.js';

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

if (!hasWebGL()) {
  document.getElementById('webgl-error').classList.remove('hidden');
  document.querySelector('[data-screen="title"]').classList.add('hidden');
} else {
  window.game = new Game(document.getElementById('c'));
}
