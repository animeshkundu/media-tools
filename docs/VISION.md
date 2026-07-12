# Media Tools Vision

*Scope: the long-term product direction and boundaries for the Chrome and Firefox extension.*

## North star

The media tools you reach for when the file must stay on your device: cut, join, convert, and compress audio and video 100% offline, with no upload, no account, no ads, and no watermark.

## The vision in 3 years

Media Tools is the default privacy-first offline media toolkit across Chrome and Firefox. It grows from the shipped audio cutter into full video and a complete workspace for everyday local-file jobs, while keeping the interaction simple: choose a file, make the change, and download the result.

It also becomes one part of a focused "offline tools" suite alongside File Tools and Photo Tools. Each product stays single-purpose, but all three share a recognizable promise: local processing, minimal permissions, no account, and no monetization that compromises trust.

The product is the trusted, mechanically verifiable alternative to upload-based websites. Users do not have to take a privacy claim on faith. They can disconnect the network, complete the job, and read a manifest with no host access or data-collection permission for local-file processing.

## Positioning vs the incumbents

The visible Chrome incumbents are not real in-extension tools. Audio Cutter has about 200,000 users and a 4.29-star rating. Video Cutter has about 100,000 users and a 3.23-star rating. Both are deprecated MV2 Chrome-App launcher shims with zero processing code. They only open `mp3cut.net` and `online-video-cutter.com`, both owned by 123apps. Chrome ended the Chrome Apps platform, leaving listings that cannot be republished. Their leading review complaint is simple: the listing opens a website instead of acting like an app.

The real competitors are upload-first or web-side, ad-supported sites such as 123apps, Clideo, VEED, EZGIF, and CloudConvert. Their funnels use ads, sign-in or Premium gates, free-tier caps, and, in some cases, watermarks. Media Tools wins by being an installed tool that performs the job locally instead of redirecting into that funnel.

Firefox is the clearest opening. The best genuine local audio trimmer has 2 daily users. There is no local video cutter, compressor, or video-to-GIF tool. Media Converter and Muxer is the one meaningful local conversion competitor, with 16,205 daily users and a 3.93-star rating, but it is narrow and beatable on speed, breadth, and usability.

These figures come from the pinned Chrome snapshot, CRX teardown, and AMO research in [the media-tools research](../.docs/ext-2-media-tools.md), with the wider suite context in [the program overview](../.docs/ext-0-overview.md).

## Who it's for

- **The Trimmer:** wants a ringtone, clip, or silence trim now, without another ad or login wall.
- **The Converter:** needs a local `.m4a`, `.mov`, or `.webm` in a format accepted by a device or upload target.
- **The Privacy-Conscious Creator/Pro:** handles client, legal, medical, or unreleased media that cannot go to an unknown server.
- **The Firefox User:** wants a polished local media tool in a browser where the category is effectively empty.

The full personas and jobs-to-be-done are defined in [PRODUCT-SPEC](./PRODUCT-SPEC.md).

## Why now

Client-side video was difficult before 2024. WebCodecs shipped stable in Firefox desktop 130 in September 2024. Mediabunny, a zero-dependency, WebCodecs-based media toolkit, reached production in 2025. Together they make the common video path small, cross-browser, and hardware-accelerated, without putting a roughly 30 MB ffmpeg.wasm core in the base bundle. The technical barrier that kept the category empty has fallen.

## The wedge

The universal promise is straightforward: a real installed tool, offline, with no upload, no ads, no account, no watermark, no arbitrary size cap, and minimal permissions. It starts work immediately and remains useful when the network is disabled.

The emphasis changes by job:

- **Conversion, joining, and video:** lead hardest with "nothing uploaded." Upload-first audio and video conversion, joining, and compression sites send files to servers, then impose limits or Premium gates. Simple video trim is not uniformly upload-based, so the claim must stay specific to the competing workflow.
- **Basic audio cut and trim:** lead with no ads, no account, no cap, instant use, and offline availability. `mp3cut.net` already performs basic cutting client-side with WASM, so claiming that local processing alone is unique would be misleading.

Two category gaps sharpen the early differentiation:

1. **Mute or remove audio from video.** No dedicated extension exists for this local-file job.
2. **Change speed or pitch with export.** Existing tools such as Transpose, with more than 1 million installs, change playback but do not produce a new local file.

## Non-goals

- **Not a tab or stream capturer.** Capture is Firefox-limited, asks for broader access, and is not a local-file transform. It weakens the cross-browser, minimal-permission wedge.
- **Not a YouTube or stream downloader.** That category is legally fraught, saturated, and unrelated to processing a file the user already owns locally.
- **Not an ad-supported, account-gated, watermarked, or upload-based tool.** Those mechanics reproduce the incumbent funnel that this product exists to replace.
- **Not a real-time equalizer, volume booster, or playback modifier.** Those are live-playback jobs, not durable offline exports.
- **Not a subscription or server product.** The core stays free and offline. Pro is a one-time unlock for power and convenience, not a dependency on hosted processing.
- **No hidden telemetry.** Secret event collection would contradict the privacy promise. Product measurement uses aggregate store and payment data, plus explicit opt-in analytics only.
