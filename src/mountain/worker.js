import { buildScene, transferables } from './scene.js';

// Builds the scene off the main thread so the page's text and transitions stay smooth while the mountain forms.
addEventListener('message', ({ data }) => {
  const scene = buildScene(data);
  postMessage(scene, transferables(scene));
});
