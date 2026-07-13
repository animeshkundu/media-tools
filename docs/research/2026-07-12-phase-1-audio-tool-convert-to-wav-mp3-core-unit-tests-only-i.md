# Phase 1 audio conversion core research

- Date: 2026-07-12
- Owner: animeshkundu/media-tools maintainers
- Work unit: Convert-to-WAV/MP3 core and unit tests only
- Controller marker: `unit-id: b5b6036d-89af-44b1-ba58-352d5d9648b2`

## Context and scope

This work unit adds a pure encode-only conversion API for already-decoded PCM. It is intentionally
limited to new files under `lib/tools/convert/`; it does not decode input, run a worker, report
progress, handle cancellation or downloads, alter the application UI, or change shared
infrastructure, manifests, workflows, or dependencies.

The requested input is PCM channel data plus a sample rate. The requested output is a downloadable
`Blob` in either PCM WAV or MP3 format, using visible output settings. WAV must be encoded locally
with a self-contained RIFF writer. MP3 must use the existing `lamejs` 1.2.1 installation.

## Repository findings

1. `ROADMAP.md:3-10` places WAV/MP3 conversion in Phase 1 after the shipped cutter and before the
   coupled speed/pitch tool.
2. `docs/PRODUCT-SPEC.md:88-102` requires explicit WAV/MP3 choices, duration and channel-layout
   preservation where supported, visible settings, local WAV encoding, bundled `lamejs` MP3
   encoding, useful rejection of bad input, and no misleading successful output.
3. `CLAUDE.md:18-26,47-53,55-64,86-93` requires tool isolation, local processing with no upload,
   bounded inputs, strict TypeScript, exact dependency versions, and heavy work outside the UI
   thread. The present unit supplies only the pure encoder that a later worker integration will
   invoke.
4. `lib/tools/audio-cutter/audio.ts:20-60` contains an existing 16-bit PCM WAV writer, but this unit
   may not edit or import cutter internals. The conversion implementation therefore needs its own
   self-contained WAV writer under `lib/tools/convert/`.
5. `lib/tools/audio-cutter/encode.worker.ts:3-69` documents the existing MP3 mechanics: clamp PCM to
   `[-1, 1]`, quantize it to signed 16-bit samples, feed `lamejs.Mp3Encoder` in 1,152-frame blocks,
   flush, and concatenate all emitted chunks. The conversion core should preserve those mechanics
   while accepting an explicit visible bitrate setting.
6. `package-lock.json:5173-5176` resolves `lamejs` to 1.2.1, and `THIRD-PARTY.md:5-11` records that
   shipped version and its MP3-encoding purpose. No dependency or provenance edit is needed for this
   unit.
7. `package.json:22-25` currently declares `lamejs` and other runtime dependencies with caret ranges,
   despite the mission-level exact-pin gate. The work unit explicitly prohibits changing
   `package.json`; this pre-existing repository-wide gate remains outside this unit and must be
   reported rather than silently claimed as satisfied.
8. `vitest.config.ts:3-7` discovers only `tests/**/*.test.ts`, while this work unit permits ownership
   only under `lib/tools/convert/**` and suggests a colocated test. A colocated
   `lib/tools/convert/convert.test.ts` would not run under `npm test`. Because changing the test
   configuration or adding `tests/convert.test.ts` violates the stated ownership boundary, this is
   a scope conflict that must be resolved before implementation. The preferred resolution is
   explicit permission for the smallest test-discovery change; without it, the required focused
   tests cannot count toward the full suite.
9. The repository has no installed `node_modules/lamejs` tree in this checkout at research time.
   Implementation must run `npm ci`, confirm the package's ESM/TypeScript import shape, and keep any
   necessary type declaration inside `lib/tools/convert/` so no prohibited shared file changes are
   needed.

## Proposed API and behavior

The conversion module should expose one asynchronous conversion entry point accepting:

- `channelData: Float32Array[]`
- `sampleRate: number`
- output settings discriminated by `format: 'wav' | 'mp3'`
- WAV visible setting: supported integer PCM bit depth
- MP3 visible setting: bitrate in kilobits per second

It should resolve to a `Blob` with `audio/wav` or `audio/mpeg`. Validation should run before output
allocation or encoder construction and reject:

- no channels or zero samples
- unequal channel lengths, because silently truncating violates duration preservation
- unsupported channel counts
- non-finite, non-integer, or non-positive sample rates
- unsupported WAV bit depths
- non-finite, non-integer, or unsupported MP3 bitrates
- RIFF payload sizes that overflow the 32-bit WAV fields or JavaScript allocation limits

For WAV, calculate all RIFF sizes with overflow-safe arithmetic, write little-endian `RIFF`, `WAVE`,
`fmt `, and `data` fields, interleave channels frame by frame, clamp samples, and quantize according
to the selected PCM bit depth. For MP3, convert at most the supported mono/stereo layout to signed
16-bit PCM, encode fixed-size blocks through the imported pinned `lamejs` encoder at the requested
bitrate, flush, concatenate, and reject an unexpectedly empty stream.

## Test strategy

Deterministic tests should directly exercise the public conversion API:

1. WAV header test: assert chunk IDs, RIFF/data lengths, PCM format code, channel count, sample rate,
   byte rate, block alignment, bit depth, MIME type, and final Blob size.
2. WAV PCM round trip: encode a short deterministic mono and stereo fixture, parse the data chunk,
   verify frame count exactly matches the input, and compare dequantized samples within one
   least-significant-bit tolerance. This proves no frame is lost or added.
3. MP3 stream test: encode a deterministic tone long enough to emit frames, assert `audio/mpeg`,
   non-empty output, locate and parse a valid MPEG Layer III frame header, and verify the encoded
   bitrate/sample-rate/channel-mode fields reflect the requested supported settings.
4. Error tests: reject empty channels, zero-length channels, mismatched lengths, invalid sample
   rates, unsupported channel counts, invalid settings, and oversized WAV metadata before returning
   a Blob.

Tests must inspect bytes rather than rely on browser media decoding, keeping Vitest deterministic in
its Node environment.

## Risks and mitigations

- **Test discovery conflict:** Resolve ownership permission before implementation; otherwise the
  required tests cannot be executed by `npm run check`.
- **Package interop and missing types:** Verify `lamejs` 1.2.1 after `npm ci`; keep a narrow local type
  declaration or adapter in the owned folder.
- **MP3 encoder constraints:** Restrict channel layouts and settings to values actually accepted by
  `lamejs`; validate before encoding and verify emitted frame metadata.
- **WAV overflow:** Reject payloads that cannot fit classic RIFF's unsigned 32-bit sizes; RF64 is not
  part of this unit.
- **Memory duplication:** Blob construction and MP3 chunk concatenation require bounded allocations.
  This pure API cannot provide streaming or cancellation; those belong to the later worker unit.
- **Sample quantization:** Explicit clamping and signed endpoint handling avoid wraparound and make
  round-trip tolerances deterministic.

## Acceptance-criteria applicability

1. **Cut region accuracy:** The cutter and selected in/out points are outside this unit. The
   conversion test will verify exact input/output WAV frame count and sample round trip within
   quantization tolerance, which is the applicable encode-only analogue.
2. **Waveform keyboard accessibility:** Not applicable; UI and `App.tsx` changes are prohibited.
3. **No-egress CSP:** Not applicable; `wxt.config.ts` and CI workflow changes are prohibited.
4. **Worker-owned heavy work:** Worker ownership, progress, cancellation, and `AudioData` cleanup are
   outside this pure core. The implementation will remain worker-callable and will not claim this
   gate.
5. **Offline end-to-end behavior:** The encoder will contain no network path, but browser offline
   processing and playback require the separate worker/UI integration.
6. **Export correctness:** Directly covered for valid WAV structure/frame preservation, MP3 frame
   validity/requested settings, and invalid PCM/settings producing errors without a Blob.
7. **Phase 1 tools:** This unit covers only the conversion core with focused tests. Join, speed,
   browser integration, and build parity beyond compilation remain separate work units.
8. **Engineering:** Implementation verification will run `npm run check`, `npm run build`, and
   `npm run build:firefox`; dependency declaration exact-pinning remains a reported prohibited-file
   blocker. No generated-authorship attribution will be added.
9. **UI polish and WCAG:** Not applicable; this unit explicitly prohibits UI integration.

## Sources

- `CLAUDE.md`
- `.github/instructions/tests.instructions.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT-SPEC.md`
- `ROADMAP.md`
- `THIRD-PARTY.md`
- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `lib/tools/audio-cutter/audio.ts`
- `lib/tools/audio-cutter/encode.worker.ts`
- `tests/audio.test.ts`

