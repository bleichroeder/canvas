import { describe, expect, test } from 'bun:test';
import { parseDashIndex, seekPointForTime } from './dash-sidx';

// Build a minimal fragmented-MP4 head: ftyp + moov + sidx (v0) with 3 segments,
// each 2s (timescale 1000 → durationTs 2000) and sizes 100/200/300.
function buildHead(): Uint8Array {
  const box = (type: string, payload: Buffer) => {
    const b = Buffer.alloc(8 + payload.length);
    b.writeUInt32BE(8 + payload.length, 0);
    b.write(type, 4, 'ascii');
    payload.copy(b, 8);
    return b;
  };
  const ftyp = box('ftyp', Buffer.alloc(8));
  const moov = box('moov', Buffer.alloc(16));

  const refs = [[100, 2000], [200, 2000], [300, 2000]];
  const sidxPayload = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 2 + 2 + refs.length * 12);
  let o = 0;
  sidxPayload.writeUInt32BE(0, o); o += 4;        // version(0)+flags
  sidxPayload.writeUInt32BE(1, o); o += 4;        // reference_ID
  sidxPayload.writeUInt32BE(1000, o); o += 4;     // timescale
  sidxPayload.writeUInt32BE(0, o); o += 4;        // earliest_presentation_time
  sidxPayload.writeUInt32BE(0, o); o += 4;        // first_offset
  sidxPayload.writeUInt16BE(0, o); o += 2;        // reserved
  sidxPayload.writeUInt16BE(refs.length, o); o += 2;
  for (const [size, dur] of refs) {
    sidxPayload.writeUInt32BE(size!, o); o += 4;  // reference_type(0)+referenced_size
    sidxPayload.writeUInt32BE(dur!, o); o += 4;   // subsegment_duration
    sidxPayload.writeUInt32BE(0, o); o += 4;      // SAP
  }
  const sidx = box('sidx', sidxPayload);
  return new Uint8Array(Buffer.concat([ftyp, moov, sidx]));
}

describe('parseDashIndex', () => {
  test('parses timescale, references, and init/segment boundaries', () => {
    const idx = parseDashIndex(buildHead());
    expect(idx.timescale).toBe(1000);
    expect(idx.references.map((r) => r.size)).toEqual([100, 200, 300]);
    expect(idx.initEnd).toBe(16 + 24 + 68);        // ftyp(16)+moov(24)+sidx(68)
    expect(idx.firstSegmentByte).toBe(idx.initEnd); // first_offset = 0
  });

  test('throws when no sidx is present', () => {
    const b = Buffer.alloc(16); b.writeUInt32BE(16, 0); b.write('ftyp', 4);
    expect(() => parseDashIndex(new Uint8Array(b))).toThrow(/no sidx/);
  });
});

describe('seekPointForTime', () => {
  const idx = parseDashIndex(buildHead());

  test('t=0 → first segment', () => {
    expect(seekPointForTime(idx, 0)).toEqual({ byteOffset: idx.firstSegmentByte, segStartSec: 0 });
  });

  test('t=3s → second segment (lands on its 2.0s keyframe boundary)', () => {
    expect(seekPointForTime(idx, 3)).toEqual({ byteOffset: idx.firstSegmentByte + 100, segStartSec: 2 });
  });

  test('t=5s → third segment', () => {
    expect(seekPointForTime(idx, 5)).toEqual({ byteOffset: idx.firstSegmentByte + 300, segStartSec: 4 });
  });

  test('sum of segment sizes is consistent (byte math)', () => {
    const total = idx.references.reduce((n, r) => n + r.size, 0);
    expect(total).toBe(600);
  });
});
