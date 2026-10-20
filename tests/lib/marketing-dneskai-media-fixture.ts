import sharp from 'sharp';

/** Synthetic scenes drawn locally for the DNESKAi media tests; five compositions that share nothing but the canvas. */
const SHAPES = [
  '<circle cx="400" cy="400" r="250" fill="#fff"/><rect x="700" y="100" width="300" height="600" fill="#036"/>',
  '<rect x="100" y="500" width="900" height="200" fill="#fff"/><circle cx="1000" cy="200" r="150" fill="#000"/>',
  '<polygon points="0,900 600,0 1200,900" fill="#0a0"/><rect x="0" y="0" width="300" height="300" fill="#fff"/><rect x="900" y="0" width="300" height="300" fill="#f00"/>',
  '<rect x="100" y="600" width="150" height="300" fill="#fff"/><rect x="350" y="300" width="150" height="600" fill="#fff"/><rect x="600" y="450" width="150" height="450" fill="#fff"/><rect x="850" y="100" width="150" height="800" fill="#fff"/>',
  '<circle cx="200" cy="700" r="180" fill="#f0f"/><circle cx="1000" cy="700" r="180" fill="#0ff"/><rect x="300" y="50" width="600" height="250" fill="#000"/>',
];
const STOPS = [['#fa3', '#215'], ['#123', '#9cf'], ['#ff0', '#404'], ['#222', '#555'], ['#eee', '#c60']];
export function scene(variant: 0 | 1 | 2 | 3 | 4, width: number, height: number) {
  const shapes = SHAPES[variant]!;
  const [from, to] = STOPS[variant]!;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 900" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="1200" height="900" fill="url(#g)"/>${shapes}</svg>`));
}
