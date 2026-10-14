// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { measuredText } from '#src/view.ts';

describe('how the stage plays, as the page shows it', () => {
  it('reads frames a second and the way to the host and back, finer below ten milliseconds', () => {
    expect(measuredText({ framesPerSecond: 60, latencyMillis: Option.some(0.42) })).toBe(
      '60 fps · 0.4 ms',
    );
    expect(measuredText({ framesPerSecond: 58, latencyMillis: Option.some(41.6) })).toBe(
      '58 fps · 42 ms',
    );
  });

  it('shows a dash while the host has not answered', () => {
    expect(measuredText({ framesPerSecond: 0, latencyMillis: Option.none() })).toBe('0 fps · – ms');
  });
});
