// Minimal DASH segment-index (sidx) parser for YouTube fragmented-MP4 streams.
//
// YouTube's high-res video/audio are fragmented MP4 served as plain byte-range
// HTTPS URLs with no external manifest. ffmpeg can't seek them over HTTP (it
// reads from byte 0), but the `sidx` box in the init segment is an exact
// time→byte map. We parse it and compute the byte offset for a seek ourselves,
// then range-fetch straight to that segment — transferring only from the seek
// point, never the preceding prefix.

export interface SidxRef {
  /** Byte length of this subsegment (one moof+mdat). */
  size: number;
  /** Duration of this subsegment, in sidx timescale units. */
  durationTs: number;
}

export interface DashIndex {
  /** Byte length of the init segment (ftyp+moov+sidx). Prepend [0, initEnd) to any segment. */
  initEnd: number;
  timescale: number;
  /** Byte offset of the first media segment (first moof). */
  firstSegmentByte: number;
  references: SidxRef[];
}

export interface SeekPoint {
  /** Byte offset to range-fetch the media from. */
  byteOffset: number;
  /** Presentation time (seconds) of the segment we land on — the keyframe ≤ target. */
  segStartSec: number;
}

const fourcc = (b: Uint8Array, o: number) =>
  String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);

/**
 * Parse the leading bytes of a fragmented MP4. `head` must span at least
 * ftyp+moov+sidx (YouTube keeps the sidx small and near the front — a ~1-2MB
 * prefix is ample). Throws if no sidx is present.
 */
export function parseDashIndex(head: Uint8Array): DashIndex {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let p = 0;
  let sidxStart = -1;
  let sidxSize = 0;
  while (p + 8 <= head.length) {
    const size = dv.getUint32(p);
    if (size < 8) break; // 64-bit/`0` sizes not expected here; bail defensively
    if (fourcc(head, p + 4) === 'sidx') { sidxStart = p; sidxSize = size; break; }
    p += size;
  }
  if (sidxStart < 0) throw new Error('no sidx box found in init segment');

  let o = sidxStart + 8;             // past box size(4) + type(4)
  const version = head[o] ?? 0;
  o += 4;                            // version(1) + flags(3)
  o += 4;                            // reference_ID(4)
  const timescale = dv.getUint32(o); o += 4;
  let firstOffset: number;
  if (version === 0) {
    o += 4;                          // earliest_presentation_time(4)
    firstOffset = dv.getUint32(o); o += 4;
  } else {
    o += 8;                          // earliest_presentation_time(8)
    firstOffset = Number(dv.getBigUint64(o)); o += 8;
  }
  o += 2;                            // reserved(2)
  const refCount = dv.getUint16(o); o += 2;

  const references: SidxRef[] = [];
  for (let i = 0; i < refCount; i++) {
    const word = dv.getUint32(o);          // reference_type(1) + referenced_size(31)
    references.push({ size: word & 0x7fffffff, durationTs: dv.getUint32(o + 4) });
    o += 12;                               // + SAP word(4)
  }

  const initEnd = sidxStart + sidxSize;
  return { initEnd, timescale, firstSegmentByte: initEnd + firstOffset, references };
}

/**
 * Byte offset + landed time for a seek to `targetSec`. Lands on the start of the
 * segment containing the target (a keyframe boundary ≤ target); the caller maps
 * that back to absolute media time.
 */
export function seekPointForTime(idx: DashIndex, targetSec: number): SeekPoint {
  let byte = idx.firstSegmentByte;
  let ts = 0;
  for (const ref of idx.references) {
    const next = ts + ref.durationTs;
    if (next / idx.timescale > targetSec) {
      return { byteOffset: byte, segStartSec: ts / idx.timescale };
    }
    byte += ref.size;
    ts = next;
  }
  return { byteOffset: idx.firstSegmentByte, segStartSec: 0 }; // target past end → start
}
