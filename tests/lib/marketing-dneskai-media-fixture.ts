import sharp from 'sharp';

/** Synthetic scenes drawn locally for the DNESKAi media tests; two compositions that share nothing but the canvas. */
export function scene(variant: 0 | 1, width: number, height: number) {
  const shapes = variant
    ? '<rect x="100" y="500" width="900" height="200" fill="#fff"/><circle cx="1000" cy="200" r="150" fill="#000"/>'
    : '<circle cx="400" cy="400" r="250" fill="#fff"/><rect x="700" y="100" width="300" height="600" fill="#036"/>';
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 900" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${variant ? '#123' : '#fa3'}"/><stop offset="1" stop-color="${variant ? '#9cf' : '#215'}"/></linearGradient></defs>
<rect width="1200" height="900" fill="url(#g)"/>${shapes}</svg>`));
}
