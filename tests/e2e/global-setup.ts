import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GECKODRIVER_VERSION = '0.37.0';

export default async function globalSetup(): Promise<void> {
  const manifest = path.join(REPO_ROOT, '.output/firefox-mv3/manifest.json');
  if (!existsSync(manifest)) {
    execSync('npm run build:firefox', { cwd: REPO_ROOT, stdio: 'inherit' });
  }

  process.env.SE_GECKODRIVER_VERSION = GECKODRIVER_VERSION;

  const managerPlatform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const managerFile = managerPlatform === 'windows' ? 'selenium-manager.exe' : 'selenium-manager';
  const managerPath = path.join(
    REPO_ROOT,
    'node_modules/selenium-webdriver/bin',
    managerPlatform,
    managerFile,
  );
  if (!existsSync(managerPath)) {
    throw new Error(`Selenium Manager was not found at ${managerPath}`);
  }

  const output = execFileSync(
    managerPath,
    ['--browser', 'firefox', '--driver-version', GECKODRIVER_VERSION, '--output', 'json'],
    { encoding: 'utf8' },
  );
  let parsed: { result?: { browser_path?: string; driver_path?: string } };
  try {
    parsed = JSON.parse(output) as {
      result?: { browser_path?: string; driver_path?: string };
    };
  } catch (error) {
    throw new Error(`Selenium Manager returned unexpected output.\nRaw output: ${output}`, {
      cause: error,
    });
  }

  const driverPath = parsed.result?.driver_path;
  const browserPath = parsed.result?.browser_path;
  if (!driverPath || !browserPath) {
    throw new Error(`Selenium Manager did not resolve both Firefox binaries: ${output}`);
  }
  if (!existsSync(driverPath) || !existsSync(browserPath)) {
    throw new Error('A Selenium Manager resolved binary does not exist on disk.');
  }

  process.env.SE_GECKODRIVER_BINARY = driverPath;
  process.env.SE_FIREFOX_BINARY = browserPath;
}
