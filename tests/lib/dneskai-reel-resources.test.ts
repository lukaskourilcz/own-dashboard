import { expect, it } from 'vitest';
import { dneskaiReelFfmpegArgs } from '@/lib/marketing/dneskai-reel-render';

it('bounds the complex graph independently of the host CPU count', () => {
  const args = dneskaiReelFfmpegArgs({ dir: '/tmp/fixture', slideCount: 2, audioFile: null, output: '/tmp/fixture/out.mp4' });
  expect(args.slice(args.indexOf('-filter_complex_threads'), args.indexOf('-filter_complex_threads') + 2)).toEqual(['-filter_complex_threads', '1']);
});
it('scopes decoder limits to every image input and the encoder limit to the output', () => {
  const args = dneskaiReelFfmpegArgs({ dir: '/tmp/fixture', slideCount: 3, audioFile: '/tmp/fixture/audio', output: '/tmp/fixture/out.mp4' });
  const inputs = args.flatMap((arg, index) => arg === '-i' ? [index] : []);
  for (const index of inputs.slice(0, 3)) expect(args.slice(index - 2, index)).toEqual(['-threads:v', '1']);
  const encoder = args.lastIndexOf('-threads:v');
  expect(encoder).toBeGreaterThan(inputs.at(-1)!);
  expect(args.slice(encoder, encoder + 2)).toEqual(['-threads:v', '2']);
});
