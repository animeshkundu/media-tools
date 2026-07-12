import { expect, firefox as playwrightFirefox, test } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Builder, By, Key, until, type WebDriver, type WebElement } from 'selenium-webdriver';
import firefox, { type Driver as FirefoxDriver } from 'selenium-webdriver/firefox.js';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const extensionPath = path.join(repositoryRoot, '.output/firefox-mv3');
const extensionUuid = '7b9f6d3a-6d4b-4d87-a90a-8f7d3fe8c001';
const sampleRate = 8_000;

type ExtensionSession = {
  downloadDirectory: string;
  driver: FirefoxDriver;
  temporaryDirectory: string;
};

async function createWav(filePath: string, durationSeconds: number): Promise<void> {
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
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0x3fff), 44 + index * 2);
  }
  await writeFile(filePath, buffer);
}

async function startExtension(): Promise<ExtensionSession> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'media-tools-firefox-'));
  const downloadDirectory = path.join(temporaryDirectory, 'downloads');
  await writeFile(path.join(temporaryDirectory, '.keep'), '');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(downloadDirectory));

  const options = new firefox.Options()
    .setBinary(playwrightFirefox.executablePath())
    .addArguments('-headless')
    .setPreference('browser.download.dir', downloadDirectory)
    .setPreference('browser.download.folderList', 2)
    .setPreference('browser.download.useDownloadDir', true)
    .setPreference('browser.helperApps.neverAsk.saveToDisk', 'audio/mpeg,audio/wav')
    .setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ 'media-tools@local': extensionUuid }),
    );
  const driver = (await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .build()) as FirefoxDriver;

  try {
    expect(await driver.installAddon(extensionPath, true)).toBe('media-tools@local');
    await driver.get(`moz-extension://${extensionUuid}/app.html`);
    await driver.wait(until.titleIs('Media Tools — Audio Cutter'), 10_000);
    return { downloadDirectory, driver, temporaryDirectory };
  } catch (error) {
    await driver.quit();
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function stopExtension(session: ExtensionSession): Promise<void> {
  await session.driver.quit();
  await rm(session.temporaryDirectory, { force: true, recursive: true });
}

async function importAudio(session: ExtensionSession, durationSeconds = 2): Promise<string> {
  const fixture = path.join(session.temporaryDirectory, `tone-${durationSeconds}.wav`);
  await createWav(fixture, durationSeconds);
  await session.driver.findElement(By.css('input[type="file"]')).sendKeys(fixture);
  await session.driver.wait(until.elementLocated(By.css('canvas[aria-label*="waveform"]')), 10_000);
  await session.driver.wait(until.elementLocated(By.xpath(`//h2[text()="${path.basename(fixture)}"]`)), 10_000);
  return fixture;
}

async function trimWithKeyboard(driver: WebDriver): Promise<{ end: number; start: number }> {
  const handles = await driver.findElements(By.css('[role="slider"]'));
  expect(handles, 'The waveform must expose separate start and end slider handles').toHaveLength(2);
  const [startHandle, endHandle] = handles as [WebElement, WebElement];

  const initialStart = Number(await startHandle.getAttribute('aria-valuenow'));
  const initialEnd = Number(await endHandle.getAttribute('aria-valuenow'));
  await startHandle.sendKeys(Key.ARROW_RIGHT);
  await endHandle.sendKeys(Key.ARROW_LEFT);

  const start = Number(await startHandle.getAttribute('aria-valuenow'));
  const end = Number(await endHandle.getAttribute('aria-valuenow'));
  expect(await startHandle.getAttribute('aria-label')).toMatch(/start|in/i);
  expect(await endHandle.getAttribute('aria-label')).toMatch(/end|out/i);
  expect(start).toBeGreaterThan(initialStart);
  expect(end).toBeLessThan(initialEnd);
  expect(end).toBeGreaterThan(start);
  return { end, start };
}

async function chooseFormat(driver: WebDriver, format: 'mp3' | 'wav'): Promise<void> {
  await driver.findElement(By.css('select')).sendKeys(format);
}

async function startExport(driver: WebDriver): Promise<void> {
  await driver.findElement(By.xpath('//button[normalize-space()="Cut & download"]')).click();
}

async function waitForDownload(directory: string, extension: '.mp3' | '.wav'): Promise<string> {
  await expect
    .poll(
      async () =>
        (await readdir(directory)).find(
          (name) => name.endsWith(extension) && !name.endsWith(`${extension}.part`),
        ),
      { timeout: 30_000 },
    )
    .toBeTruthy();
  const name = (await readdir(directory)).find((entry) => entry.endsWith(extension));
  if (!name) throw new Error(`No ${extension} download was created.`);
  return path.join(directory, name);
}

test('imports audio, renders the waveform, and keyboard-trims both handles', async () => {
  const session = await startExtension();
  try {
    await importAudio(session);
    const canvas = session.driver.findElement(By.css('canvas[aria-label*="waveform"]'));
    const size = await canvas.getRect();
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    await trimWithKeyboard(session.driver);
  } finally {
    await stopExtension(session);
  }
});

test('exports a keyboard-selected WAV region with frame-accurate duration', async () => {
  const session = await startExtension();
  try {
    await importAudio(session);
    const selection = await trimWithKeyboard(session.driver);
    await chooseFormat(session.driver, 'wav');
    await startExport(session.driver);

    const output = await waitForDownload(session.downloadDirectory, '.wav');
    const wav = await readFile(output);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    const outputFrames = wav.readUInt32LE(40) / 2;
    const selectedFrames = Math.round((selection.end - selection.start) * sampleRate);
    expect(Math.abs(outputFrames - selectedFrames)).toBeLessThanOrEqual(1);
    expect(await session.driver.findElement(By.css('[aria-live="polite"]')).getText()).toContain('Done.');
  } finally {
    await stopExtension(session);
  }
});

test('exports MP3 from the built extension', async () => {
  const session = await startExtension();
  try {
    await importAudio(session);
    await chooseFormat(session.driver, 'mp3');
    await startExport(session.driver);

    const output = await waitForDownload(session.downloadDirectory, '.mp3');
    const mp3 = await readFile(output);
    expect(mp3.length).toBeGreaterThan(1_000);
    expect(mp3.some((value, index) => value === 0xff && (mp3[index + 1] & 0xe0) === 0xe0)).toBe(true);
    expect(await session.driver.findElement(By.css('[aria-live="polite"]')).getText()).toContain('Done.');
  } finally {
    await stopExtension(session);
  }
});

test('cancels active MP3 work and leaves no partial download', async () => {
  const session = await startExtension();
  try {
    await importAudio(session, 180);
    await chooseFormat(session.driver, 'mp3');
    await startExport(session.driver);

    const cancel = await session.driver.wait(
      until.elementLocated(By.xpath('//button[normalize-space()="Cancel"]')),
      10_000,
    );
    const progress = await session.driver.findElement(By.css('[role="progressbar"]'));
    expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
    await cancel.click();
    await session.driver.wait(
      until.elementTextContains(
        session.driver.findElement(By.css('[aria-live="polite"]')),
        'Export cancelled.',
      ),
      10_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await readdir(session.downloadDirectory)).toEqual([]);
  } finally {
    await stopExtension(session);
  }
});
