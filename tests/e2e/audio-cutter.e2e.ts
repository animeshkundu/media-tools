import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Builder, By, type WebElement } from 'selenium-webdriver';
import {
  Context,
  Driver as FirefoxDriver,
  Options as FirefoxOptions,
  ServiceBuilder,
} from 'selenium-webdriver/firefox.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_DIR = path.join(REPO_ROOT, '.output/firefox-mv3');
const EXTENSION_ID = 'audiocutter@animesh.kundus.in';
const SAMPLE_RATE = 44_100;
const DOWNLOAD_TIMEOUT = 30_000;

type Mp3EncoderInstance = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
};

type Mp3Library = {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance;
};

type Mp3Support = {
  probeError?: string;
  reason: string;
  supported: boolean;
};

let driver: FirefoxDriver | undefined;
let appUrl = '';
let workDir = '';
let downloadDir = '';
let cutWav = '';
let noEgressWav = '';
let mp3ExportWav = '';
let mp3Input = '';
let joinWavOne = '';
let joinWavTwo = '';
let speedWav = '';
let volumeWav = '';

function createWav(durationSeconds: number, frequency: number): Buffer {
  const sampleCount = Math.round(SAMPLE_RATE * durationSeconds);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * 0.5;
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2);
  }
  return buffer;
}

async function createMp3Fixture(filePath: string): Promise<void> {
  const source = await readFile(path.join(REPO_ROOT, 'public/vendor/lame.min.js'), 'utf8');
  const context = vm.createContext({ console }) as vm.Context & { fixtureLame?: Mp3Library };
  vm.runInContext(`${source}\nglobalThis.fixtureLame = lamejs;`, context);
  const library = context.fixtureLame;
  if (!library) throw new Error('The bundled MP3 encoder did not initialize.');

  const samples = new Int16Array(SAMPLE_RATE);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(Math.sin((2 * Math.PI * 523.25 * index) / SAMPLE_RATE) * 0x3fff);
  }

  const encoder = new library.Mp3Encoder(1, SAMPLE_RATE, 192);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < samples.length; offset += 1152) {
    const encoded = encoder.encodeBuffer(samples.subarray(offset, offset + 1152));
    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(Buffer.from(finalChunk));
  const mp3 = Buffer.concat(chunks);
  validateGeneratedMp3(mp3);
  await writeFile(filePath, mp3);
}

async function prepareFixtures(): Promise<void> {
  workDir = await mkdtemp(path.join(tmpdir(), 'media-tools-e2e-'));
  downloadDir = path.join(workDir, 'downloads');
  await mkdir(downloadDir);

  cutWav = path.join(workDir, 'cut-source.wav');
  noEgressWav = path.join(workDir, 'no-egress-source.wav');
  mp3ExportWav = path.join(workDir, 'mp3-export-source.wav');
  mp3Input = path.join(workDir, 'mp3-input-source.mp3');
  joinWavOne = path.join(workDir, 'join-one.wav');
  joinWavTwo = path.join(workDir, 'join-two.wav');
  speedWav = path.join(workDir, 'speed-source.wav');
  volumeWav = path.join(workDir, 'volume-source.wav');

  await Promise.all([
    writeFile(cutWav, createWav(1, 440)),
    writeFile(noEgressWav, createWav(0.5, 330)),
    writeFile(mp3ExportWav, createWav(1, 660)),
    writeFile(joinWavOne, createWav(0.4, 330)),
    writeFile(joinWavTwo, createWav(0.6, 550)),
    writeFile(speedWav, createWav(1, 275)),
    writeFile(volumeWav, createWav(1, 440)),
    createMp3Fixture(mp3Input),
  ]);
}

async function buildGeckoDriver(): Promise<FirefoxDriver> {
  const geckodriverBinary = process.env.SE_GECKODRIVER_BINARY;
  const firefoxBinary = process.env.SE_FIREFOX_BINARY;
  if (!geckodriverBinary) {
    throw new Error('SE_GECKODRIVER_BINARY was not set by global setup.');
  }
  if (!firefoxBinary) {
    throw new Error('SE_FIREFOX_BINARY was not set by global setup.');
  }

  const options = new FirefoxOptions()
    .addArguments('--headless')
    .addArguments('-remote-allow-system-access')
    .setPreference('browser.download.folderList', 2)
    .setPreference('browser.download.dir', downloadDir)
    .setPreference('browser.download.useDownloadDir', true)
    .setPreference('browser.download.alwaysOpenPanel', false)
    .setPreference('browser.download.manager.showWhenStarting', false)
    .setPreference('browser.download.always_ask_before_handling_new_types', false)
    .setPreference(
      'browser.helperApps.neverAsk.saveToDisk',
      'audio/wav,audio/x-wav,audio/mpeg,application/octet-stream',
    );
  options.setPageLoadStrategy('none');
  options.setBinary(firefoxBinary);

  return new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new ServiceBuilder(geckodriverBinary))
    .build() as unknown as FirefoxDriver;
}

async function extensionUuid(activeDriver: FirefoxDriver): Promise<string> {
  await activeDriver.setContext(Context.CHROME);
  try {
    const raw = await activeDriver.executeScript<string>(
      `return Services.prefs.getCharPref('extensions.webextensions.uuids');`,
    );
    const uuid = (JSON.parse(raw) as Record<string, string>)[EXTENSION_ID];
    if (!uuid) throw new Error(`No moz-extension UUID was found for ${EXTENSION_ID}.`);
    return uuid;
  } finally {
    await activeDriver.setContext(Context.CONTENT);
  }
}

function getDriver(): FirefoxDriver {
  if (!driver) throw new Error('The Firefox driver is not initialized.');
  return driver;
}

async function visibleElement(selector: string, timeout = 30_000): Promise<WebElement> {
  const activeDriver = getDriver();
  await activeDriver.wait(
    async () => {
      try {
        const elements = await activeDriver.findElements(By.css(selector));
        for (const element of elements) {
          if (await element.isDisplayed()) return true;
        }
      } catch {
        return false;
      }
      return false;
    },
    timeout,
    `Timed out waiting for visible selector: ${selector}`,
  );

  const elements = await activeDriver.findElements(By.css(selector));
  for (const element of elements) {
    if (await element.isDisplayed()) return element;
  }
  throw new Error(`The visible selector disappeared: ${selector}`);
}

async function waitForText(selector: string, expected: string | RegExp, timeout = 30_000): Promise<string> {
  const activeDriver = getDriver();
  let matchedText = '';
  await activeDriver.wait(
    async () => {
      try {
        const elements = await activeDriver.findElements(By.css(selector));
        for (const element of elements) {
          if (!(await element.isDisplayed())) continue;
          const text = await element.getText();
          const matches = typeof expected === 'string' ? text.includes(expected) : expected.test(text);
          if (matches) {
            matchedText = text;
            return true;
          }
        }
      } catch {
        return false;
      }
      return false;
    },
    timeout,
    `Timed out waiting for ${selector} to contain ${String(expected)}`,
  );
  return matchedText;
}

async function openApp(): Promise<void> {
  const activeDriver = getDriver();
  await activeDriver.get(appUrl);
  await activeDriver.wait(
    async () => {
      try {
        return await activeDriver.executeScript<boolean>(
          `return document.readyState === 'interactive' || document.readyState === 'complete';`,
        );
      } catch {
        return false;
      }
    },
    30_000,
    'The extension document did not become ready.',
  );
  await waitForText('h1', 'Audio Cutter');
  expect(await activeDriver.getCurrentUrl()).toBe(appUrl);
}

async function clickTab(label: string): Promise<void> {
  const tabs = await getDriver().findElements(By.css('[role="tab"]'));
  for (const tab of tabs) {
    if ((await tab.getText()) === label) {
      await tab.click();
      await getDriver().wait(
        async () => (await tab.getAttribute('aria-selected')) === 'true',
        10_000,
        `The ${label} tab was not selected.`,
      );
      return;
    }
  }
  throw new Error(`Could not find the ${label} tab.`);
}

async function clickButton(label: string): Promise<void> {
  const buttons = await getDriver().findElements(By.css('button'));
  for (const button of buttons) {
    if ((await button.getText()) === label && (await button.isDisplayed())) {
      await button.click();
      return;
    }
  }
  throw new Error(`Could not find the ${label} button.`);
}

async function uploadFiles(filePaths: string[]): Promise<void> {
  const input = await getDriver().findElement(By.css('input[type="file"]'));
  await input.sendKeys(filePaths.join('\n'));
}

async function setControlValue(element: WebElement, value: string): Promise<void> {
  const activeDriver = getDriver();
  await activeDriver.executeScript(
    `
      const control = arguments[0];
      const value = arguments[1];
      const prototype = control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error('The native value setter is unavailable.');
      setter.call(control, value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    `,
    element,
    value,
  );
  await activeDriver.wait(
    async () => (await activeDriver.executeScript<string>('return arguments[0].value;', element)) === value,
    10_000,
    `The form control did not update to ${value}.`,
  );
}

async function setFormValue(selector: string, value: string): Promise<void> {
  await setControlValue(await getDriver().findElement(By.css(selector)), value);
}

async function clearDownloads(): Promise<void> {
  const entries = await readdir(downloadDir);
  await Promise.all(entries.map((entry) => rm(path.join(downloadDir, entry), { force: true })));
}

async function waitForDownload(fileName: string): Promise<string> {
  const filePath = path.join(downloadDir, fileName);
  const started = Date.now();
  let previousSize = -1;
  let stableChecks = 0;
  while (Date.now() - started < DOWNLOAD_TIMEOUT) {
    try {
      const entries = await readdir(downloadDir);
      const fileStat = await stat(filePath);
      if (fileStat.isFile() && fileStat.size > 44 && !entries.some((entry) => entry.endsWith('.part'))) {
        stableChecks = fileStat.size === previousSize ? stableChecks + 1 : 0;
        previousSize = fileStat.size;
        if (stableChecks >= 2) return filePath;
      } else {
        stableChecks = 0;
      }
    } catch {
      stableChecks = 0;
    }
    await delay(100);
  }
  throw new Error(`Firefox did not finish the expected download: ${fileName}`);
}

async function validateWav(filePath: string): Promise<Buffer> {
  const wav = await readFile(filePath);
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.subarray(8, 12).toString()).toBe('WAVE');
  expect(wav.length).toBeGreaterThan(44);
  return wav;
}

function wavFrames(wav: Buffer): number {
  return wav.readUInt32LE(40) / wav.readUInt16LE(32);
}

function mp3FrameInfo(
  mp3: Uint8Array,
  offset: number,
): { channels: number; length: number; sampleRate: number } | undefined {
  const first = mp3[offset];
  const second = mp3[offset + 1];
  const third = mp3[offset + 2];
  const fourth = mp3[offset + 3];
  if (
    first !== 0xff ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    (second & 0xe0) !== 0xe0
  ) {
    return undefined;
  }

  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return undefined;
  }

  const mpeg1 = versionBits === 3;
  const bitrates = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rateDivisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = [44_100, 48_000, 32_000][sampleRateIndex]! / rateDivisor;
  const padding = (third >> 1) & 1;
  const length = Math.floor(((mpeg1 ? 144_000 : 72_000) * bitrates[bitrateIndex]!) / sampleRate) + padding;
  if (offset + length > mp3.length) return undefined;
  return { channels: fourth >> 6 === 3 ? 1 : 2, length, sampleRate };
}

function findMp3Frame(mp3: Uint8Array): number {
  for (let offset = 0; offset + 4 <= mp3.length; offset += 1) {
    if (mp3FrameInfo(mp3, offset)) return offset;
  }
  return -1;
}

function hasMp3Frame(mp3: Uint8Array): boolean {
  return findMp3Frame(mp3) >= 0;
}

function validateGeneratedMp3(mp3: Uint8Array): void {
  let offset = findMp3Frame(mp3);
  if (offset < 0) throw new Error('The generated MP3 fixture has no complete MPEG audio frame.');
  for (let frame = 0; frame < 3; frame += 1) {
    const info = mp3FrameInfo(mp3, offset);
    if (!info || info.sampleRate !== SAMPLE_RATE || info.channels !== 1) {
      throw new Error('The generated MP3 fixture does not contain consecutive 44.1 kHz mono frames.');
    }
    offset += info.length;
  }
}

async function probeMp3Support(): Promise<Mp3Support> {
  return getDriver().executeAsyncScript<Mp3Support>(`
    const done = arguments[arguments.length - 1];
    (async () => {
      if (typeof AudioDecoder === 'undefined') {
        done({ supported: false, reason: 'AudioDecoder is unavailable in the extension page' });
        return;
      }
      try {
        const support = await AudioDecoder.isConfigSupported({
          codec: 'mp3',
          sampleRate: ${SAMPLE_RATE},
          numberOfChannels: 1,
        });
        done({
          supported: support.supported === true,
          reason: support.supported ? 'AudioDecoder accepted the MP3 configuration' : 'AudioDecoder rejected the MP3 configuration',
        });
      } catch (error) {
        done({
          supported: false,
          reason: 'AudioDecoder support probe failed',
          probeError: String(error),
        });
      }
    })();
  `);
}

test.describe('Audio Cutter installed Firefox extension', () => {
  test.beforeAll(async () => {
    await prepareFixtures();
    driver = await buildGeckoDriver();
    await driver.installAddon(EXTENSION_DIR, true);
    const uuid = await extensionUuid(driver);
    appUrl = `moz-extension://${uuid}/app.html`;
  });

  test.afterAll(async () => {
    if (driver) {
      try {
        await driver.quit();
      } catch (error) {
        console.warn(`Firefox shutdown warning: ${String(error)}`);
      }
    }
    if (workDir) await rm(workDir, { force: true, recursive: true });
  });

  test('app loads under the installed extension origin', async () => {
    await openApp();
    expect(await (await visibleElement('h1')).getText()).toBe('Audio Cutter');
    expect(await getDriver().getCurrentUrl()).toMatch(/^moz-extension:\/\/[^/]+\/app\.html$/);
  });

  test('cuts WAV and downloads a valid WAV under extension CSP', async () => {
    await clearDownloads();
    await openApp();
    await uploadFiles([cutWav]);
    await waitForText('h2', path.basename(cutWav));
    await waitForText('p[aria-live="polite"]', 'Drag the gold handles');
    await visibleElement('canvas[aria-label^="Audio waveform"]');
    const trimInputs = await getDriver().findElements(By.css('input[type="number"]'));
    expect(trimInputs).toHaveLength(2);
    await setControlValue(trimInputs[0]!, '0.25');
    await setControlValue(trimInputs[1]!, '0.75');
    const handles = await getDriver().findElements(By.css('[role="slider"]'));
    expect(handles).toHaveLength(2);
    expect(Number(await handles[0]!.getAttribute('aria-valuenow'))).toBeCloseTo(0.25, 4);
    expect(Number(await handles[1]!.getAttribute('aria-valuenow'))).toBeCloseTo(0.75, 4);
    await setFormValue('select', 'wav');

    await clickButton('Cut & download');
    await waitForText('p[aria-live="polite"]', 'Done.');
    const output = await waitForDownload('cut-source-trimmed.wav');
    const wav = await validateWav(output);
    expect(wavFrames(wav)).toBe(Math.round(SAMPLE_RATE * 0.5));
  });

  test('loads tool resources without network egress', async () => {
    await openApp();
    await uploadFiles([noEgressWav]);
    await waitForText('p[aria-live="polite"]', 'Drag the gold handles');
    await visibleElement('canvas[aria-label^="Audio waveform"]');

    const prefix = appUrl.slice(0, appUrl.lastIndexOf('/') + 1);
    const externalRequests = await getDriver().executeScript<string[]>(
      `return performance.getEntriesByType('resource')
        .map(function(entry) { return entry.name; })
        .filter(function(url) {
          return !url.startsWith(arguments[0]) && !url.startsWith('about:');
        });`,
      prefix,
    );
    expect(externalRequests, `External requests: ${(externalRequests ?? []).join(', ')}`).toHaveLength(0);
  });

  test('converts WAV input to MP3', async () => {
    await clearDownloads();
    await openApp();
    await clickTab('Convert WAV / MP3');
    await waitForText('h1', 'Convert WAV / MP3');
    await uploadFiles([mp3ExportWav]);
    await waitForText('p[aria-live="polite"]', 'Choose WAV or MP3, then export.');
    await setFormValue('select', 'mp3');

    await clickButton('Convert & download');
    await waitForText('p[aria-live="polite"]', 'Done.');
    const output = await waitForDownload('mp3-export-source-trimmed.mp3');
    const mp3 = await readFile(output);
    expect(mp3.length).toBeGreaterThan(1_000);
    expect(hasMp3Frame(mp3)).toBe(true);
  });

  test('handles MP3 input according to the installed Firefox decoder capability', async () => {
    await clearDownloads();
    await openApp();
    const support = await probeMp3Support();
    expect(support.probeError, 'The AudioDecoder support probe must not throw.').toBeUndefined();
    console.log(
      `[e2e] MP3 input branch: ${support.supported ? 'supported' : 'graceful-error'} (${support.reason})`,
    );
    await uploadFiles([mp3Input]);

    if (support.supported) {
      await waitForText('h2', path.basename(mp3Input));
      await waitForText('p[aria-live="polite"]', 'Drag the gold handles');
      await visibleElement('canvas[aria-label^="Audio waveform"]');
      await clickButton('Cut & download');
      await waitForText('p[aria-live="polite"]', 'Done.');
      const output = await waitForDownload('mp3-input-source-trimmed.wav');
      await validateWav(output);
      return;
    }

    const error = await waitForText(
      'p[aria-live="polite"]',
      /browser cannot decode.*MP3|browser cannot decode this MP3/i,
    );
    expect(error).toMatch(/MP3/);
    await waitForText('[role="button"]', 'Drop a WAV or MP3 file here');
    expect(await (await visibleElement('h1')).getText()).toBe('Audio Cutter');
    await delay(1_000);
    expect(await readdir(downloadDir)).toEqual([]);
  });

  test('joins two WAV files and downloads valid merged audio', async () => {
    await clearDownloads();
    await openApp();
    await clickTab('Join / merge');
    await waitForText('h1', 'Audio Join / Merge');
    await uploadFiles([joinWavOne, joinWavTwo]);
    await waitForText('p[aria-live="polite"]', 'Ready. 2 tracks added.');
    await waitForText('section', path.basename(joinWavOne));
    await waitForText('section', path.basename(joinWavTwo));

    await clickButton('Join & download');
    await waitForText('p[aria-live="polite"]', 'Done.');
    const output = await waitForDownload('joined-audio-trimmed.wav');
    const wav = await validateWav(output);
    expect(wavFrames(wav)).toBe(SAMPLE_RATE);
  });

  test('changes WAV speed and downloads valid resampled audio', async () => {
    await clearDownloads();
    await openApp();
    await clickTab('Change speed');
    await waitForText('h1', 'Change Speed');
    await uploadFiles([speedWav]);
    await waitForText('p[aria-live="polite"]', 'Set the speed factor and export.');
    await setFormValue('input[type="range"][aria-label="Speed factor"]', '2');
    await waitForText('section', '2.00×');

    await clickButton('Change speed & download');
    await waitForText('p[aria-live="polite"]', 'Done.');
    const output = await waitForDownload('speed-source-trimmed.wav');
    const wav = await validateWav(output);
    expect(wavFrames(wav)).toBe(Math.round(SAMPLE_RATE / 2));
  });

  test('normalizes volume and fades through the production worker', async () => {
    await clearDownloads();
    await openApp();
    await clickTab('Volume & fades');
    await waitForText('h1', 'Volume & Fades');
    await uploadFiles([volumeWav]);
    await waitForText('p[aria-live="polite"]', 'Set gain and fades');
    await setFormValue('input[type="range"][aria-label="Fade in duration"]', '0.1');
    await setFormValue('input[type="range"][aria-label="Fade out duration"]', '0.1');
    await (await visibleElement('input[type="checkbox"]')).click();
    await waitForText('section', '-1.0 dBFS');

    await clickButton('Apply & download');
    await waitForText('p[aria-live="polite"]', 'Done.');
    const output = await waitForDownload('volume-source-trimmed.wav');
    const wav = await validateWav(output);
    expect(wavFrames(wav)).toBe(SAMPLE_RATE);
    expect(wav.readInt16LE(44)).toBe(0);
    expect(Math.abs(wav.readInt16LE(wav.length - 2))).toBeLessThanOrEqual(1);
    let outputPeak = 0;
    for (let offset = 44; offset < wav.length; offset += 2) {
      outputPeak = Math.max(outputPeak, Math.abs(wav.readInt16LE(offset)));
    }
    expect(outputPeak / 0x7fff).toBeCloseTo(10 ** (-1 / 20), 3);
  });
});

test.describe('global setup provisioning', () => {
  test('SE_GECKODRIVER_BINARY is set and exists', () => {
    const driverPath = process.env.SE_GECKODRIVER_BINARY;
    expect(driverPath, 'Global setup must resolve geckodriver.').toBeTruthy();
    expect(existsSync(driverPath!)).toBe(true);
  });

  test('SE_FIREFOX_BINARY is set and exists', () => {
    const browserPath = process.env.SE_FIREFOX_BINARY;
    expect(browserPath, 'Global setup must resolve Firefox.').toBeTruthy();
    expect(existsSync(browserPath!)).toBe(true);
  });

  test('SE_FIREFOX_BINARY is applied through FirefoxOptions.setBinary()', () => {
    const browserPath = process.env.SE_FIREFOX_BINARY;
    expect(browserPath).toBeTruthy();
    const options = new FirefoxOptions();
    options.setBinary(browserPath!);
    const firefoxOptions = options.get('moz:firefoxOptions') as { binary?: string } | undefined;
    expect(firefoxOptions?.binary).toBe(browserPath);
  });
});
