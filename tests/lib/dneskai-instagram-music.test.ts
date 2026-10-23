import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { instagramItemDetail, instagramMusic } from '@/lib/marketing/dneskai-providers';

describe('a reel\'s sound from the scraper (#167)', () => {
  it('keeps the audio id, title, artist, original and muted flags and the plays of a video', () => {
    expect(instagramItemDetail({ ownerUsername: 'itstundeanthony', type: 'Video', productType: 'clips', videoPlayCount: 12_345,
      musicInfo: { audio_id: '587784541076604', song_name: 'Trend Song ', artist_name: 'Trend Artist', uses_original_audio: false, should_mute_audio: false } }))
      .toEqual({ ownerUsername: 'itstundeanthony', mediaType: 'video', music: { audioId: '587784541076604', title: 'Trend Song', artist: 'Trend Artist', originalAudio: false, muted: false }, plays: 12_345 });
  });
  it('drops a sound without a numeric id, on a carousel, or with nonsense plays', () => {
    expect(instagramMusic({ audio_id: 'original_123' })).toBeUndefined();
    expect(instagramItemDetail({ ownerUsername: 'x', type: 'Sidecar', musicInfo: { audio_id: '1' } })).toEqual({ ownerUsername: 'x', mediaType: 'carousel' });
    expect(instagramItemDetail({ ownerUsername: 'x', type: 'Video', videoPlayCount: -1, musicInfo: { audio_id: 7, uses_original_audio: true } }))
      .toEqual({ ownerUsername: 'x', mediaType: 'video', music: { audioId: '7', originalAudio: true, muted: false } });
  });
});
