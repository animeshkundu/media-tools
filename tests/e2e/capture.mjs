import { Buffer } from 'node:buffer';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Builder, By } from 'selenium-webdriver';
import {
  Context,
  Options as FirefoxOptions,
  ServiceBuilder,
} from 'selenium-webdriver/firefox.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_DIR = path.join(REPO_ROOT, '.output/firefox-mv3');
const SCREENSHOT_DIR = path.join(REPO_ROOT, 'docs/media/screenshots');
const STAGING_DIR = path.join(REPO_ROOT, 'docs/media/.capture-staging');
const DOWNLOAD_DIR = path.join(STAGING_DIR, 'downloads');
const GECKODRIVER_VERSION = '0.37.0';
const EXTENSION_ID = 'audiocutter@animesh.kundus.in';
const WIDTH = 1728;
const HEIGHT = 1117;
const SAMPLE_RATE = 44_100;
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
  return { geckodriver: result.driver_path, firefox: result.browser_path };
}

function createWav(durationSeconds, frequency) {
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
    const time = index / SAMPLE_RATE;
    const envelope = 0.38 + 0.35 * Math.sin(2 * Math.PI * 0.8 * time);
    const sample =
      (Math.sin(2 * Math.PI * frequency * time) +
        0.3 * Math.sin(2 * Math.PI * frequency * 1.5 * time)) *
      envelope *
      0.55;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff), 44 + index * 2);
  }
  return buffer;
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
      const elements = await driver.findElements(By.css(selector));
      for (const element of elements) {
        try {
          if (await element.isDisplayed()) return true;
        } catch {
          // React may replace the node while the capture waits; retry the selector.
        }
      }
      return false;
    },
    timeout,
    `Timed out waiting for visible selector: ${selector}`,
  );
  const elements = await driver.findElements(By.css(selector));
  for (const element of elements) {
    try {
      if (await element.isDisplayed()) return element;
    } catch {
      // A later call will report a stable missing selector if replacement continues.
    }
  }
  throw new Error(`Visible selector disappeared: ${selector}`);
}

async function waitForText(driver, selector, expected, timeout = 30_000) {
  await driver.wait(
    async () => {
      const elements = await driver.findElements(By.css(selector));
      for (const element of elements) {
        try {
          if ((await element.isDisplayed()) && (await element.getText()).includes(expected)) return true;
        } catch {
          // Status nodes are replaced during worker progress; retry the selector.
        }
      }
      return false;
    },
    timeout,
    `Timed out waiting for ${selector} to contain ${JSON.stringify(expected)}`,
  );
}

async function findButton(driver, label) {
  const buttons = await driver.findElements(By.css('button'));
  for (const button of buttons) {
    if ((await button.isDisplayed()) && (await button.getText()) === label) return button;
  }
  throw new Error(`Could not find the ${label} button.`);
}

async function setControl(driver, selector, value) {
  const element = await driver.findElement(By.css(selector));
  await driver.executeScript(
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
}

async function setViewport(driver) {
  await driver.manage().window().setRect({ width: WIDTH, height: HEIGHT, x: 0, y: 0 });
  const viewport = await driver.executeScript(
    'return { width: window.innerWidth, height: window.innerHeight };',
  );
  await driver.manage().window().setRect({
    width: WIDTH + (WIDTH - viewport.width),
    height: HEIGHT + (HEIGHT - viewport.height),
    x: 0,
    y: 0,
  });
}

async function capture(driver, destination) {
  await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const finish = () => requestAnimationFrame(() => requestAnimationFrame(done));
    if (document.fonts?.ready) document.fonts.ready.then(finish, finish);
    else finish();
  `);
  const png = Buffer.from(await driver.takeScreenshot(), 'base64');
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Firefox returned an invalid PNG for ${destination}`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT || png.length < 20_000) {
    throw new Error(`Unexpected screenshot ${width}x${height} (${png.length} bytes)`);
  }
  await writeFile(destination, png);
}

async function waitForDownload(filePath, timeout = 30_000) {
  const started = Date.now();
  let previousSize = -1;
  while (Date.now() - started < timeout) {
    try {
      const info = await stat(filePath);
      const entries = await readdir(path.dirname(filePath));
      if (
        info.size > 1_000 &&
        info.size === previousSize &&
        !entries.some((entry) => entry.endsWith('.part'))
      ) {
        return;
      }
      previousSize = info.size;
    } catch {
      previousSize = -1;
    }
    await delay(100);
  }
  throw new Error(`Firefox did not finish the expected download: ${filePath}`);
}

async function publish(staged, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.new`;
  await rm(temporary, { force: true });
  await rename(staged, temporary);
  await rename(temporary, destination);
}

async function main() {
  execSync('npm run build:firefox', { cwd: REPO_ROOT, stdio: 'inherit' });
  await rm(STAGING_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const dialogue = path.join(STAGING_DIR, 'interview-dialogue.wav');
  const music = path.join(STAGING_DIR, 'ambient-bed.wav');
  const corrupt = path.join(STAGING_DIR, 'corrupt.wav');
  await Promise.all([
    writeFile(dialogue, createWav(6, 220)),
    writeFile(music, createWav(4, 330)),
    writeFile(corrupt, Buffer.from('This is deliberately not an audio file.\n')),
  ]);

  const binaries = provisionFirefox();
  const options = new FirefoxOptions()
    .addArguments('--headless')
    .addArguments('-remote-allow-system-access')
    .setPageLoadStrategy('none')
    .setPreference('browser.download.folderList', 2)
    .setPreference('browser.download.dir', DOWNLOAD_DIR)
    .setPreference('browser.download.useDownloadDir', true)
    .setPreference('browser.download.alwaysOpenPanel', false)
    .setPreference('browser.helperApps.neverAsk.saveToDisk', 'audio/wav,audio/mpeg');
  options.setBinary(binaries.firefox);
  const driver = (await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new ServiceBuilder(binaries.geckodriver))
    .build());

  const staged = {
    empty: path.join(STAGING_DIR, 'audio-studio-empty.png'),
    imported: path.join(STAGING_DIR, 'audio-studio-imported.png'),
    edited: path.join(STAGING_DIR, 'audio-studio-edited.png'),
    exported: path.join(STAGING_DIR, 'audio-studio-exported.png'),
    error: path.join(STAGING_DIR, 'audio-studio-error.png'),
  };

  try {
    await driver.installAddon(EXTENSION_DIR, true);
    const uuid = await extensionUuid(driver);
    const appUrl = `moz-extension://${uuid}/app.html`;
    await driver.get(appUrl);
    await waitForText(driver, 'h1', 'Audio Studio');
    await setViewport(driver);
    await capture(driver, staged.empty);

    const input = await driver.findElement(By.css('input[type="file"]'));
    await input.sendKeys(`${dialogue}\n${music}`);
    await waitForText(driver, 'p[aria-live="polite"]', 'Ready. 2 files added');
    await waitForSelector(driver, 'canvas[aria-label^="Multitrack waveform timeline"]');
    await capture(driver, staged.imported);

    await setControl(driver, 'input[aria-label="Selected clip speed"]', '1.5');
    await setControl(driver, 'input[aria-label="Selected clip gain"]', '1.15');
    await setControl(driver, 'input[aria-label="Selected clip fade in"]', '0.4');
    await setControl(driver, 'input[aria-label="Selected clip fade out"]', '0.6');
    await setControl(driver, 'select[aria-label="Selected track EQ preset"]', 'warm');
    await setControl(driver, 'input[aria-label="Timeline zoom"]', '120');
    await setControl(driver, 'input[aria-label="Timeline playhead"]', '2.5');
    await waitForText(driver, 'label', 'Speed 1.50x');
    await capture(driver, staged.edited);

    await setControl(driver, 'select[aria-label="Export format"]', 'mp3');
    await (await findButton(driver, 'Export MP3')).click();
    await waitForText(driver, 'p[aria-live="polite"]', 'Done. Your multitrack MP3');
    const mp3Path = path.join(DOWNLOAD_DIR, 'My-audio-project.mp3');
    await waitForDownload(mp3Path);
    const mp3 = await readFile(mp3Path);
    if (!mp3.some((byte, index) => byte === 0xff && (mp3[index + 1] & 0xe0) === 0xe0)) {
      throw new Error('The captured workflow did not produce a recognizable MP3 frame.');
    }
    await capture(driver, staged.exported);

    await driver.get(appUrl);
    await waitForText(driver, 'h1', 'Audio Studio');
    const invalidInput = await driver.findElement(By.css('input[type="file"]'));
    await invalidInput.sendKeys(corrupt);
    await waitForSelector(driver, '[role="alert"]');
    await capture(driver, staged.error);
  } finally {
    await driver.quit();
  }

  const artifacts = Object.entries(staged).map(([name, source]) => [
    source,
    path.join(SCREENSHOT_DIR, `audio-studio-${name}.png`),
  ]);
  for (const [source, destination] of artifacts) await publish(source, destination);
  for (const [, destination] of artifacts) {
    const info = await stat(destination);
    process.stdout.write(`[capture] ${path.relative(REPO_ROOT, destination)} (${info.size} bytes)\n`);
  }
  await rm(STAGING_DIR, { recursive: true, force: true });
}

await main();
