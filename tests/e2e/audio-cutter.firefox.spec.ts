import { createServer, type Server } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const extensionPath = path.join(repositoryRoot, '.output/firefox-mv3');
const sampleRate = 8_000;

let server: Server;
let extensionUrl: string;

function contentType(filePath: string): string {
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.html')) return 'text/html';
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const filePath = path.resolve(extensionPath, `.${pathname === '/' ? '/app.html' : pathname}`);
      if (!filePath.startsWith(`${extensionPath}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': contentType(filePath) }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The extension test server did not start.');
  extensionUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function createWav(
  testInfo: TestInfo,
  durationSeconds: number,
  fixtureSampleRate = sampleRate,
): Promise<string> {
  const sampleCount = Math.round(fixtureSampleRate * durationSeconds);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(fixtureSampleRate, 24);
  buffer.writeUInt32LE(fixtureSampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * index) / fixtureSampleRate) * 0x3fff),
      44 + index * 2,
    );
  }
  const filePath = testInfo.outputPath(`tone-${durationSeconds}.wav`);
  await writeFile(filePath, buffer);
  return filePath;
}

async function openAudio(
  page: Page,
  testInfo: TestInfo,
  durationSeconds = 2,
  fixtureSampleRate = sampleRate,
): Promise<string> {
  const fixture = await createWav(testInfo, durationSeconds, fixtureSampleRate);
  await page.goto(`${extensionUrl}/app.html`);
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: path.basename(fixture) })).toBeVisible();
  await expect(page.getByLabel(/audio waveform/i)).toBeVisible();
  return fixture;
}

async function keyboardTrim(page: Page): Promise<{ end: number; start: number }> {
  const sliders = page.getByRole('slider');
  await expect(sliders).toHaveCount(2);
  const startHandle = sliders.nth(0);
  const endHandle = sliders.nth(1);
  const initialStart = Number(await startHandle.getAttribute('aria-valuenow'));
  const initialEnd = Number(await endHandle.getAttribute('aria-valuenow'));

  await startHandle.press('ArrowRight');
  await endHandle.press('ArrowLeft');

  const start = Number(await startHandle.getAttribute('aria-valuenow'));
  const end = Number(await endHandle.getAttribute('aria-valuenow'));
  expect(start).toBeGreaterThan(initialStart);
  expect(end).toBeLessThan(initialEnd);
  expect(end).toBeGreaterThan(start);
  return { end, start };
}

test('opens, decodes, keyboard-trims, and exports WAV from the built artifact', async ({
  page,
}, testInfo) => {
  await openAudio(page, testInfo);
  const waveform = page.getByLabel(/audio waveform/i);
  const bounds = await waveform.boundingBox();
  expect(bounds?.width).toBeGreaterThan(0);
  expect(bounds?.height).toBeGreaterThan(0);
  const selection = await keyboardTrim(page);

  await page.getByLabel('Export format').selectOption('wav');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Cut & download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tone-2-trimmed.wav');
  const output = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(output);

  const wav = await readFile(output);
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.subarray(8, 12).toString()).toBe('WAVE');
  const outputFrames = wav.readUInt32LE(40) / wav.readUInt16LE(32);
  const selectedFrames = Math.round((selection.end - selection.start) * wav.readUInt32LE(24));
  expect(Math.abs(outputFrames - selectedFrames)).toBeLessThanOrEqual(1);
  await expect(page.getByText(/^Done\./)).toBeVisible();
});

test('exports MP3 from the built artifact', async ({ page }, testInfo) => {
  await openAudio(page, testInfo);
  await page.getByLabel('Export format').selectOption('mp3');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Cut & download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tone-2-trimmed.mp3');
  const output = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(output);

  const mp3 = await readFile(output);
  expect(mp3.length).toBeGreaterThan(1_000);
  expect(mp3.some((value, index) => value === 0xff && (mp3[index + 1] & 0xe0) === 0xe0)).toBe(
    true,
  );
  await expect(page.getByText(/^Done\./)).toBeVisible();
});

test('cancels an active export without emitting a partial download', async ({ page }, testInfo) => {
  await openAudio(page, testInfo, 600, 44_100);
  await page.getByLabel('Export format').selectOption('mp3');
  let downloads = 0;
  page.on('download', () => {
    downloads += 1;
  });

  await page.getByRole('button', { name: 'Cut & download' }).click();
  const progress = page.getByRole('progressbar');
  await expect(progress).toBeVisible();
  expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByText('Export cancelled.')).toBeVisible();
  await expect(progress).toBeHidden();
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  await expect(page.getByRole('button', { name: 'Cut & download' })).toBeEnabled();
});

test('rejects corrupt input and returns to the file picker', async ({ page }, testInfo) => {
  const corrupt = testInfo.outputPath('corrupt.wav');
  await writeFile(corrupt, Buffer.from('not a media file'));
  await page.goto(`${extensionUrl}/app.html`);
  await page.locator('input[type="file"]').setInputFiles(corrupt);

  await expect(page.getByText('Only valid PCM WAV or MP3 input is supported.')).toBeVisible();
  await expect(page.getByText('Drop a WAV or MP3 file here')).toBeVisible();
  await expect(page.getByLabel(/audio waveform/i)).toHaveCount(0);
});
