// Builds target sets off the main thread; a million samples take long enough to stutter a scroll.
import { introSet, markSet, photoSet, globeSet, citySet } from './targets.js';

const builders = { intro: introSet, mark: markSet, photo: photoSet, globe: globeSet, city: citySet };

self.onmessage = ({ data }) => {
  const { id, kind, options } = data;
  try {
    const set = builders[kind](options);
    self.postMessage({ id, set }, [set.pos.buffer, set.col.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error && error.stack || error) });
  }
};
