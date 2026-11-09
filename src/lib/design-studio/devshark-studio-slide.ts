import type { DevsharkDeck } from '@/lib/marketing/devshark-deck';
import { layoutDevsharkSlide } from './devshark-layout';

/** The brand pictures the Studio draws devShark slides with, the same files the renderer verifies (public/design-studio). */
export const DEVSHARK_STUDIO_ASSETS = { finGreen: '/design-studio/devshark/devshark-fin-clean-green.svg', finInk: '/design-studio/devshark/devshark-fin-clean-ink.svg', logoWhite: '/design-studio/devshark/devshark-logo-horizontal-white.svg' };

/**
 * The SVG the devShark Studio shows for one slide of a concept: the exact SVG the renderer publishes. The Studio's
 * canvas and the publishing calendar (owner request, 9 November 2026) both draw a concept with this.
 */
export const devsharkStudioSlideSvg = (deck: Pick<DevsharkDeck, 'cover' | 'slides'>, index: number) => layoutDevsharkSlide(deck, index, DEVSHARK_STUDIO_ASSETS).svg;
