import './styles/main.css';
import { Game } from './game/Game';

/**
 * Entry point. Boots the game and shows any fatal error on the loading screen
 * instead of leaving the player looking at a black canvas.
 */
async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  try {
    const game = new Game(canvas);
    await game.init();
    // Handy for tinkering from the browser console.
    (window as unknown as { game: Game }).game = game;
  } catch (err) {
    console.error('[NissanZ] Fatal start-up error:', err);
    const text = document.getElementById('loader-text');
    if (text) {
      text.textContent = `ERROR: ${(err as Error).message ?? 'unknown'}`;
      text.style.color = '#ff6b7a';
    }
  }
}

// Prevent the page from scrolling / zooming while driving.
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);

void boot();
