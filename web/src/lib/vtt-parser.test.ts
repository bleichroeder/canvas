import { describe, expect, test } from 'bun:test';
import { parseVtt, findCue } from './vtt-parser';

describe('parseVtt', () => {
  test('decodes HTML entities in cue text (YouTube VTT)', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nwell &gt; that&#39;s it &amp; more';
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("well > that's it & more");
  });

  test('strips inline tags but keeps text, then decodes entities', () => {
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<c.colorE5E5E5>a &lt;b&gt;</c>';
    expect(parseVtt(vtt)[0]!.text).toBe('a <b>');
  });

  test('numeric and hex entities', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\n&#233; &#xe9;';
    expect(parseVtt(vtt)[0]!.text).toBe('é é');
  });

  test('leaves unknown entities untouched', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nA&bogus;B';
    expect(parseVtt(vtt)[0]!.text).toBe('A&bogus;B');
  });

  test('findCue locates the active cue', () => {
    const cues = parseVtt('WEBVTT\n\n00:00.000 --> 00:02.000\nfirst\n\n00:02.000 --> 00:04.000\nsecond');
    expect(findCue(cues, 1)!.text).toBe('first');
    expect(findCue(cues, 3)!.text).toBe('second');
    expect(findCue(cues, 5)).toBeNull();
  });
});
