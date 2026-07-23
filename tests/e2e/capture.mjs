import { Buffer } from 'node:buffer';
import { execFile, execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Builder, By } from 'selenium-webdriver';
import { Context, Options as FirefoxOptions, ServiceBuilder } from 'selenium-webdriver/firefox.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_DIR = path.join(REPO_ROOT, '.output/firefox-mv3');
const MEDIA_DIR = path.join(REPO_ROOT, 'docs/media');
const SCREENSHOT_DIR = path.join(MEDIA_DIR, 'screenshots');
const STAGING_DIR = path.join(MEDIA_DIR, '.capture-staging');
const FRAME_DIR = path.join(STAGING_DIR, 'frames');
const DOWNLOAD_DIR = path.join(STAGING_DIR, 'downloads');
const FIXTURE_WAV = path.join(STAGING_DIR, 'audio-cutter-tone.wav');
const INVALID_WAV = path.join(STAGING_DIR, 'corrupt.wav');
const GECKODRIVER_VERSION = '0.37.0';
const EXTENSION_ID = 'audiocutter@animesh.kundus.in';
const WIDTH = 1280;
const HEIGHT = 800;
const FRAME_RATE = 4;
const FRAME_HOLD_MS = 250;
const FIXTURE_DURATION_SECONDS = 6;
const FIXTURE_SAMPLE_RATE = 8_000;
const TRIM_START_SECONDS = 1.25;
const TRIM_END_SECONDS = 4.75;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function seleniumManagerPath() {
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const executable = platform === 'windows' ? 'selenium-manager.exe' : 'selenium-manager';
  return path.join(REPO_ROOT, 'node_modules/selenium-webdriver/bin', platform, executable);
}

function provisionFirefox() {
  const manager = seleniumManagerPath();
  if (!existsSync(manager)) throw new Error(`Selenium Manager was not found at ${manager}`);

  const output = execFileSync(
    manager,
    ['--browser', 'firefox', '--driver-version', GECKODRIVER_VERSION, '--output', 'json'],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(output);
  const result = parsed?.result;
  if (!result?.driver_path || !result?.browser_path) {
    throw new Error(`Selenium Manager did not resolve both binaries: ${output}`);
  }
  if (!existsSync(result.driver_path) || !existsSync(result.browser_path)) {
    throw new Error('A Selenium Manager resolved binary does not exist on disk.');
  }
  return { geckodriver: result.driver_path, firefox: result.browser_path };
}

async function firefoxVersion(binary) {
  const { stdout, stderr } = await execFileAsync(binary, ['--version']);
  return `${stdout}${stderr}`.trim();
}

async function extensionUuid(driver) {
  await driver.setContext(Context.CHROME);
  try {
    const raw = await driver.executeScript(
      `return Services.prefs.getCharPref('extensions.webextensions.uuids');`,
    );
    const uuid = JSON.parse(raw)[EXTENSION_ID];
    if (!uuid) throw new Error(`No moz-extension UUID found for ${EXTENSION_ID}`);
    return uuid;
  } finally {
    await driver.setContext(Context.CONTENT);
  }
}

async function waitForSelector(driver, selector, timeout = 30_000) {
  await driver.wait(
    async () => {
      try {
        const elements = await driver.findElements(By.css(selector));
        for (const element of elements) {
          if (await element.isDisplayed()) return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    timeout,
    `Timed out waiting for visible selector: ${selector}`,
  );
  const elements = await driver.findElements(By.css(selector));
  for (const element of elements) {
    if (await element.isDisplayed()) return element;
  }
  throw new Error(`Visible selector disappeared: ${selector}`);
}

async function waitForText(driver, selector, expected, timeout = 30_000) {
  await waitForSelector(driver, selector, timeout);
  await driver.wait(
    async () => {
      try {
        const elements = await driver.findElements(By.css(selector));
        for (const element of elements) {
          if ((await element.getText()).includes(expected)) return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    timeout,
    `Timed out waiting for ${selector} to contain ${JSON.stringify(expected)}`,
  );
}

async function findByText(driver, selector, expected) {
  await waitForText(driver, selector, expected);
  const elements = await driver.findElements(By.css(selector));
  for (const element of elements) {
    if ((await element.getText()).includes(expected)) return element;
  }
  throw new Error(`Could not find ${selector} containing ${JSON.stringify(expected)}`);
}

async function navigateToApp(driver, appUrl) {
  await driver.get(appUrl);
  await driver.wait(
    async () => {
      try {
        return await driver.executeScript(
          `return document.readyState === 'interactive' || document.readyState === 'complete';`,
        );
      } catch {
        return false;
      }
    },
    30_000,
    'The extension document did not become ready.',
  );
  await waitForText(driver, 'h1', 'Audio Cutter');
  await waitForText(driver, '[role="button"]', 'Drop a WAV or MP3 file here');
  const currentUrl = await driver.getCurrentUrl();
  if (currentUrl !== appUrl) {
    throw new Error(`Firefox did not stay on the installed extension page: ${currentUrl}`);
  }
}

async function setViewport(driver) {
  await driver.manage().window().setRect({ width: WIDTH, height: HEIGHT, x: 0, y: 0 });
  const viewport = await driver.executeScript(
    'return { width: window.innerWidth, height: window.innerHeight };',
  );
  await driver
    .manage()
    .window()
    .setRect({
      width: WIDTH + (WIDTH - viewport.width),
      height: HEIGHT + (HEIGHT - viewport.height),
      x: 0,
      y: 0,
    });
  const adjusted = await driver.executeScript(
    'return { width: window.innerWidth, height: window.innerHeight };',
  );
  if (adjusted.width !== WIDTH || adjusted.height !== HEIGHT) {
    throw new Error(`Could not set Firefox viewport to ${WIDTH}x${HEIGHT}: ${JSON.stringify(adjusted)}`);
  }
}

async function settlePage(driver) {
  await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const finish = () => requestAnimationFrame(() => requestAnimationFrame(done));
    if (document.fonts?.ready) document.fonts.ready.then(finish, finish);
    else finish();
  `);
}

async function screenshot(driver, destination) {
  await settlePage(driver);
  const currentUrl = await driver.getCurrentUrl();
  if (!currentUrl.startsWith('moz-extension://')) {
    throw new Error(`Refusing to capture a non-extension page: ${currentUrl}`);
  }
  const png = Buffer.from(await driver.takeScreenshot(), 'base64');
  if (png.length < 10_000 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Firefox returned a trivial or invalid PNG for ${destination}`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`Unexpected screenshot dimensions ${width}x${height}; expected ${WIDTH}x${HEIGHT}`);
  }
  await writeFile(destination, png);
}

function framePath(number) {
  return path.join(FRAME_DIR, `frame-${String(number).padStart(4, '0')}.png`);
}

async function captureFrames(driver, start, count) {
  for (let index = 0; index < count; index += 1) {
    await screenshot(driver, framePath(start + index));
    await delay(FRAME_HOLD_MS);
  }
  return start + count;
}

async function captureScroll(driver, start, targetY, steps) {
  const initialY = Number(await driver.executeScript('return window.scrollY;'));
  let nextFrame = start;
  for (let step = 1; step <= steps; step += 1) {
    const y = initialY + ((targetY - initialY) * step) / steps;
    await driver.executeScript('window.scrollTo(0, arguments[0]);', y);
    nextFrame = await captureFrames(driver, nextFrame, 1);
  }
  return nextFrame;
}

function createWav(durationSeconds = FIXTURE_DURATION_SECONDS, sampleRate = FIXTURE_SAMPLE_RATE) {
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const envelope = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.25 * time));
    const tone = Math.sin(2 * Math.PI * 440 * time) + 0.3 * Math.sin(2 * Math.PI * 660 * time);
    const sample = Math.max(-1, Math.min(1, tone * envelope * 0.62));
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2);
  }
  return buffer;
}

async function assertWaveform(driver) {
  const canvas = await waitForSelector(driver, 'canvas[aria-label^="Audio waveform"]');
  const result = await driver.executeScript((element) => {
    const bounds = element.getBoundingClientRect();
    const context = element.getContext('2d');
    if (!context) return { width: bounds.width, height: bounds.height, coloredPixels: 0 };
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let coloredPixels = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (green > 90 && green > red * 1.2 && green > blue * 1.05) coloredPixels += 1;
    }
    return { width: bounds.width, height: bounds.height, coloredPixels };
  }, canvas);
  if (result.width < 100 || result.height < 100 || result.coloredPixels < 100) {
    throw new Error(`The real waveform was not visibly rendered: ${JSON.stringify(result)}`);
  }
}

async function setNumberInput(driver, element, value) {
  await driver.executeScript(
    `
      const input = arguments[0];
      const nextValue = arguments[1];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('The native input value setter is unavailable.');
      setter.call(input, String(nextValue));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    `,
    element,
    value,
  );
  await driver.wait(
    async () => Math.abs(Number(await element.getAttribute('value')) - value) < 0.001,
    10_000,
    `The trim field did not update to ${value}`,
  );
}

async function assertTrimSelection(driver) {
  const handles = await driver.findElements(By.css('[role="slider"]'));
  if (handles.length !== 2) throw new Error(`Expected two trim handles, found ${handles.length}`);
  const start = Number(await handles[0].getAttribute('aria-valuenow'));
  const end = Number(await handles[1].getAttribute('aria-valuenow'));
  if (Math.abs(start - TRIM_START_SECONDS) > 0.001 || Math.abs(end - TRIM_END_SECONDS) > 0.001) {
    throw new Error(`Unexpected trim selection: ${start}–${end}`);
  }
}

async function waitForDownload(filePath, timeout = 30_000) {
  const started = Date.now();
  let previousSize = -1;
  let stableChecks = 0;
  while (Date.now() - started < timeout) {
    try {
      const info = await stat(filePath);
      const entries = await readdir(path.dirname(filePath));
      const hasPartialDownload = entries.some((entry) => entry.endsWith('.part'));
      if (info.size > 44 && !hasPartialDownload) {
        stableChecks = info.size === previousSize ? stableChecks + 1 : 0;
        previousSize = info.size;
        if (stableChecks >= 2) return info;
      } else {
        stableChecks = 0;
      }
    } catch {
      stableChecks = 0;
    }
    await delay(100);
  }
  throw new Error(`Firefox did not finish the expected download: ${filePath}`);
}

async function validateDownloadedWav(filePath) {
  const wav = await readFile(filePath);
  if (wav.subarray(0, 4).toString() !== 'RIFF' || wav.subarray(8, 12).toString() !== 'WAVE') {
    throw new Error(`The downloaded export is not a WAV file: ${filePath}`);
  }
  const frames = wav.readUInt32LE(40) / wav.readUInt16LE(32);
  const expected = Math.round((TRIM_END_SECONDS - TRIM_START_SECONDS) * wav.readUInt32LE(24));
  if (Math.abs(frames - expected) > 1) {
    throw new Error(`The downloaded WAV has ${frames} frames; expected ${expected}`);
  }
}

async function probeVideo(filePath, expectedCodec, frameCount) {
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,nb_frames:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { encoding: 'utf8' },
    ),
  );
  const stream = probe.streams?.[0];
  if (stream?.codec_name !== expectedCodec || stream.width !== WIDTH || stream.height !== HEIGHT) {
    throw new Error(`Unexpected encoded video properties: ${JSON.stringify(probe)}`);
  }
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration < frameCount / FRAME_RATE - 0.1) {
    throw new Error(`Unexpected encoded video duration: ${JSON.stringify(probe)}`);
  }
  return duration;
}

async function encodeVideos(frameCount) {
  const mp4 = path.join(STAGING_DIR, 'audio-cutter-demo.mp4');
  const webm = path.join(STAGING_DIR, 'audio-cutter-demo.webm');
  const common = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(FRAME_RATE),
    '-i',
    path.join(FRAME_DIR, 'frame-%04d.png'),
    '-frames:v',
    String(frameCount),
  ];

  await execFileAsync('ffmpeg', [
    ...common,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-threads',
    '1',
    '-metadata',
    'title=Audio Cutter real Firefox demo',
    mp4,
  ]);
  await execFileAsync('ffmpeg', [
    ...common,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '36',
    '-pix_fmt',
    'yuv420p',
    '-row-mt',
    '0',
    '-threads',
    '1',
    '-metadata',
    'title=Audio Cutter real Firefox demo',
    webm,
  ]);

  const mp4Duration = await probeVideo(mp4, 'h264', frameCount);
  const webmDuration = await probeVideo(webm, 'vp9', frameCount);
  return { mp4, mp4Duration, webm, webmDuration };
}

async function publish(staged, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.new`;
  await rm(temporary, { force: true });
  await rename(staged, temporary);
  await rename(temporary, destination);
}

async function main() {
  process.stdout.write(`[capture] Node: ${process.version}\n`);
  execSync('npm run build:firefox', { cwd: REPO_ROOT, stdio: 'inherit' });

  await rm(STAGING_DIR, { recursive: true, force: true });
  await mkdir(FRAME_DIR, { recursive: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  await writeFile(FIXTURE_WAV, createWav());
  await writeFile(INVALID_WAV, Buffer.from('This is deliberately not an audio file.\n'));

  const binaries = provisionFirefox();
  const version = await firefoxVersion(binaries.firefox);
  process.stdout.write(`[capture] geckodriver ${GECKODRIVER_VERSION}: ${binaries.geckodriver}\n`);
  process.stdout.write(`[capture] Firefox: ${version}\n`);
  process.stdout.write(`[capture] Firefox binary: ${binaries.firefox}\n`);
  process.stdout.write(`[capture] Installing real extension: ${EXTENSION_DIR}\n`);

  const options = new FirefoxOptions()
    .addArguments('--headless')
    .addArguments('-remote-allow-system-access')
    .setPageLoadStrategy('none')
    .setPreference('browser.download.folderList', 2)
    .setPreference('browser.download.dir', DOWNLOAD_DIR)
    .setPreference('browser.download.useDownloadDir', true)
    .setPreference('browser.download.alwaysOpenPanel', false)
    .setPreference('browser.download.manager.showWhenStarting', false)
    .setPreference('browser.helperApps.neverAsk.saveToDisk', 'audio/wav,audio/x-wav');
  options.setBinary(binaries.firefox);
  const driver = new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new ServiceBuilder(binaries.geckodriver))
    .build();

  try {
    await driver.installAddon(EXTENSION_DIR, true);
    const uuid = await extensionUuid(driver);
    const appUrl = `moz-extension://${uuid}/app.html`;
    process.stdout.write(`[capture] moz-extension UUID: ${uuid}\n`);
    process.stdout.write(`[capture] Navigating: ${appUrl}\n`);

    await navigateToApp(driver, appUrl);
    await setViewport(driver);
    await screenshot(driver, path.join(STAGING_DIR, 'audio-cutter-empty.png'));

    let nextFrame = 0;
    nextFrame = await captureFrames(driver, nextFrame, 8);

    const fileInput = await driver.findElement(By.css('input[type="file"]'));
    await fileInput.sendKeys(FIXTURE_WAV);
    await waitForText(driver, 'h2', path.basename(FIXTURE_WAV));
    await waitForText(driver, 'p[aria-live="polite"]', 'Drag the gold handles');
    await assertWaveform(driver);
    await screenshot(driver, path.join(STAGING_DIR, 'audio-cutter-waveform.png'));
    nextFrame = await captureFrames(driver, nextFrame, 8);

    const trimInputs = await driver.findElements(By.css('input[type="number"]'));
    if (trimInputs.length !== 2) {
      throw new Error(`Expected two exact trim fields, found ${trimInputs.length}`);
    }
    await setNumberInput(driver, trimInputs[0], TRIM_START_SECONDS);
    await setNumberInput(driver, trimInputs[1], TRIM_END_SECONDS);
    await assertTrimSelection(driver);
    await assertWaveform(driver);
    await screenshot(driver, path.join(STAGING_DIR, 'audio-cutter-trim-selected.png'));
    nextFrame = await captureFrames(driver, nextFrame, 8);

    const exportButton = await findByText(driver, 'button', 'Cut & download');
    const targetScroll = Number(
      await driver.executeScript(
        'return Math.max(0, arguments[0].getBoundingClientRect().top + window.scrollY - 620);',
        exportButton,
      ),
    );
    nextFrame = await captureScroll(driver, nextFrame, targetScroll, 4);
    nextFrame = await captureFrames(driver, nextFrame, 4);

    await exportButton.click();
    await waitForText(
      driver,
      'p[aria-live="polite"]',
      'Done. Your download was created without uploading the file.',
    );
    const downloadedWav = path.join(DOWNLOAD_DIR, 'audio-cutter-tone-trimmed.wav');
    await waitForDownload(downloadedWav);
    await validateDownloadedWav(downloadedWav);
    const status = await findByText(driver, 'p[aria-live="polite"]', 'Done.');
    await driver.executeScript(
      (element) => element.scrollIntoView({ block: 'end', inline: 'nearest' }),
      status,
    );
    await driver.wait(
      async () => {
        const bounds = await driver.executeScript(
          `
            const rect = arguments[0].getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
          `,
          status,
        );
        return bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight;
      },
      10_000,
      'The export confirmation did not settle fully inside the viewport.',
    );
    await screenshot(driver, path.join(STAGING_DIR, 'audio-cutter-export-done.png'));
    nextFrame = await captureFrames(driver, nextFrame, 10);

    const multitrackTab = await findByText(driver, '[role="tab"]', 'Multitrack studio');
    await multitrackTab.click();
    await waitForText(driver, 'h1', 'Multitrack Studio');
    await driver.executeScript('window.scrollTo(0, 0);');
    const multitrackInput = await driver.findElement(By.css('input[type="file"]'));
    await multitrackInput.sendKeys(FIXTURE_WAV);
    await waitForText(driver, 'p[aria-live="polite"]', 'Ready. 1 file added');
    const targetTrack = await driver.findElement(
      By.css('[data-testid="multitrack-studio"] select'),
    );
    await driver.executeScript(
      "arguments[0].value = 'track-music'; arguments[0].dispatchEvent(new Event('change', { bubbles: true }));",
      targetTrack,
    );
    const addTone = await findByText(driver, 'button', 'Add Tone');
    await addTone.click();
    await waitForText(driver, 'p[aria-live="polite"]', '440 Hz tone added');
    await screenshot(driver, path.join(STAGING_DIR, 'multitrack-studio.png'));
    nextFrame = await captureFrames(driver, nextFrame, 8);

    const timelineCanvas = await waitForSelector(
      driver,
      'canvas[aria-label^="Multitrack waveform timeline"]',
    );
    await driver.executeScript(
      (element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }),
      timelineCanvas,
    );
    await screenshot(driver, path.join(STAGING_DIR, 'multitrack-timeline.png'));
    nextFrame = await captureFrames(driver, nextFrame, 8);

    const videos = await encodeVideos(nextFrame);

    await navigateToApp(driver, appUrl);
    await setViewport(driver);
    const invalidInput = await driver.findElement(By.css('input[type="file"]'));
    await invalidInput.sendKeys(INVALID_WAV);
    await waitForText(driver, 'p[aria-live="polite"]', 'Only valid PCM WAV or MP3 input is supported.');
    await waitForText(driver, '[role="button"]', 'Drop a WAV or MP3 file here');
    const errorWaveforms = await driver.findElements(By.css('canvas[aria-label^="Audio waveform"]'));
    if (errorWaveforms.length !== 0) throw new Error('The corrupt-file state still shows a waveform.');
    await screenshot(driver, path.join(STAGING_DIR, 'audio-cutter-error.png'));

    const artifacts = [
      [path.join(STAGING_DIR, 'audio-cutter-empty.png'), path.join(SCREENSHOT_DIR, 'audio-cutter-empty.png')],
      [
        path.join(STAGING_DIR, 'audio-cutter-waveform.png'),
        path.join(SCREENSHOT_DIR, 'audio-cutter-waveform.png'),
      ],
      [
        path.join(STAGING_DIR, 'audio-cutter-trim-selected.png'),
        path.join(SCREENSHOT_DIR, 'audio-cutter-trim-selected.png'),
      ],
      [
        path.join(STAGING_DIR, 'audio-cutter-export-done.png'),
        path.join(SCREENSHOT_DIR, 'audio-cutter-export-done.png'),
      ],
      [path.join(STAGING_DIR, 'audio-cutter-error.png'), path.join(SCREENSHOT_DIR, 'audio-cutter-error.png')],
      [
        path.join(STAGING_DIR, 'multitrack-studio.png'),
        path.join(SCREENSHOT_DIR, 'multitrack-studio.png'),
      ],
      [
        path.join(STAGING_DIR, 'multitrack-timeline.png'),
        path.join(SCREENSHOT_DIR, 'multitrack-timeline.png'),
      ],
      [videos.mp4, path.join(MEDIA_DIR, 'audio-cutter-demo.mp4')],
      [videos.webm, path.join(MEDIA_DIR, 'audio-cutter-demo.webm')],
    ];
    for (const [staged, destination] of artifacts) await publish(staged, destination);

    process.stdout.write(
      `[capture] Video frames: ${nextFrame} genuine Firefox screenshots at ${FRAME_RATE} fps\n`,
    );
    process.stdout.write(`[capture] MP4 duration: ${videos.mp4Duration.toFixed(3)} seconds\n`);
    process.stdout.write(`[capture] WebM duration: ${videos.webmDuration.toFixed(3)} seconds\n`);
    for (const [, destination] of artifacts) {
      const info = await stat(destination);
      process.stdout.write(`[capture] Wrote ${path.relative(REPO_ROOT, destination)} (${info.size} bytes)\n`);
    }
  } finally {
    try {
      await driver.quit();
    } catch (error) {
      process.stderr.write(
        `[capture] Firefox shutdown warning: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    await rm(STAGING_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
