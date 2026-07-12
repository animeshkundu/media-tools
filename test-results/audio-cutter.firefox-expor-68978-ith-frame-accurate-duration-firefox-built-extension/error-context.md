# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: audio-cutter.firefox.spec.ts >> exports a keyboard-selected WAV region with frame-accurate duration
- Location: tests/e2e/audio-cutter.firefox.spec.ts:145:1

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1
Received:    71478
```

# Test source

```ts
  59  |     .setFirefoxOptions(options)
  60  |     .build()) as FirefoxDriver;
  61  | 
  62  |   try {
  63  |     expect(await driver.installAddon(extensionPath, true)).toBe('media-tools@local');
  64  |     await driver.get(`moz-extension://${extensionUuid}/app.html`);
  65  |     await driver.wait(until.titleIs('Media Tools — Audio Cutter'), 10_000);
  66  |     return { downloadDirectory, driver, temporaryDirectory };
  67  |   } catch (error) {
  68  |     await driver.quit();
  69  |     await rm(temporaryDirectory, { force: true, recursive: true });
  70  |     throw error;
  71  |   }
  72  | }
  73  | 
  74  | async function stopExtension(session: ExtensionSession): Promise<void> {
  75  |   await session.driver.quit();
  76  |   await rm(session.temporaryDirectory, { force: true, recursive: true });
  77  | }
  78  | 
  79  | async function importAudio(session: ExtensionSession, durationSeconds = 2): Promise<string> {
  80  |   const fixture = path.join(session.temporaryDirectory, `tone-${durationSeconds}.wav`);
  81  |   await createWav(fixture, durationSeconds);
  82  |   await session.driver.findElement(By.css('input[type="file"]')).sendKeys(fixture);
  83  |   await session.driver.wait(until.elementLocated(By.css('canvas[aria-label*="waveform"]')), 10_000);
  84  |   await session.driver.wait(until.elementLocated(By.xpath(`//h2[text()="${path.basename(fixture)}"]`)), 10_000);
  85  |   return fixture;
  86  | }
  87  | 
  88  | async function trimWithKeyboard(driver: WebDriver): Promise<{ end: number; start: number }> {
  89  |   const handles = await driver.findElements(By.css('[role="slider"]'));
  90  |   expect(handles, 'The waveform must expose separate start and end slider handles').toHaveLength(2);
  91  |   const [startHandle, endHandle] = handles as [WebElement, WebElement];
  92  | 
  93  |   const initialStart = Number(await startHandle.getAttribute('aria-valuenow'));
  94  |   const initialEnd = Number(await endHandle.getAttribute('aria-valuenow'));
  95  |   await startHandle.sendKeys(Key.ARROW_RIGHT);
  96  |   await endHandle.sendKeys(Key.ARROW_LEFT);
  97  | 
  98  |   const start = Number(await startHandle.getAttribute('aria-valuenow'));
  99  |   const end = Number(await endHandle.getAttribute('aria-valuenow'));
  100 |   expect(await startHandle.getAttribute('aria-label')).toMatch(/start|in/i);
  101 |   expect(await endHandle.getAttribute('aria-label')).toMatch(/end|out/i);
  102 |   expect(start).toBeGreaterThan(initialStart);
  103 |   expect(end).toBeLessThan(initialEnd);
  104 |   expect(end).toBeGreaterThan(start);
  105 |   return { end, start };
  106 | }
  107 | 
  108 | async function chooseFormat(driver: WebDriver, format: 'mp3' | 'wav'): Promise<void> {
  109 |   await driver.findElement(By.css('select')).sendKeys(format);
  110 | }
  111 | 
  112 | async function startExport(driver: WebDriver): Promise<void> {
  113 |   await driver.findElement(By.xpath('//button[normalize-space()="Cut & download"]')).click();
  114 | }
  115 | 
  116 | async function waitForDownload(directory: string, extension: '.mp3' | '.wav'): Promise<string> {
  117 |   await expect
  118 |     .poll(
  119 |       async () =>
  120 |         (await readdir(directory)).find(
  121 |           (name) => name.endsWith(extension) && !name.endsWith(`${extension}.part`),
  122 |         ),
  123 |       { timeout: 30_000 },
  124 |     )
  125 |     .toBeTruthy();
  126 |   const name = (await readdir(directory)).find((entry) => entry.endsWith(extension));
  127 |   if (!name) throw new Error(`No ${extension} download was created.`);
  128 |   return path.join(directory, name);
  129 | }
  130 | 
  131 | test('imports audio, renders the waveform, and keyboard-trims both handles', async () => {
  132 |   const session = await startExtension();
  133 |   try {
  134 |     await importAudio(session);
  135 |     const canvas = session.driver.findElement(By.css('canvas[aria-label*="waveform"]'));
  136 |     const size = await canvas.getRect();
  137 |     expect(size.width).toBeGreaterThan(0);
  138 |     expect(size.height).toBeGreaterThan(0);
  139 |     await trimWithKeyboard(session.driver);
  140 |   } finally {
  141 |     await stopExtension(session);
  142 |   }
  143 | });
  144 | 
  145 | test('exports a keyboard-selected WAV region with frame-accurate duration', async () => {
  146 |   const session = await startExtension();
  147 |   try {
  148 |     await importAudio(session);
  149 |     const selection = await trimWithKeyboard(session.driver);
  150 |     await chooseFormat(session.driver, 'wav');
  151 |     await startExport(session.driver);
  152 | 
  153 |     const output = await waitForDownload(session.downloadDirectory, '.wav');
  154 |     const wav = await readFile(output);
  155 |     expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  156 |     expect(wav.subarray(8, 12).toString()).toBe('WAVE');
  157 |     const outputFrames = wav.readUInt32LE(40) / 2;
  158 |     const selectedFrames = Math.round((selection.end - selection.start) * sampleRate);
> 159 |     expect(Math.abs(outputFrames - selectedFrames)).toBeLessThanOrEqual(1);
      |                                                     ^ Error: expect(received).toBeLessThanOrEqual(expected)
  160 |     expect(await session.driver.findElement(By.css('[aria-live="polite"]')).getText()).toContain('Done.');
  161 |   } finally {
  162 |     await stopExtension(session);
  163 |   }
  164 | });
  165 | 
  166 | test('exports MP3 from the built extension', async () => {
  167 |   const session = await startExtension();
  168 |   try {
  169 |     await importAudio(session);
  170 |     await chooseFormat(session.driver, 'mp3');
  171 |     await startExport(session.driver);
  172 | 
  173 |     const output = await waitForDownload(session.downloadDirectory, '.mp3');
  174 |     const mp3 = await readFile(output);
  175 |     expect(mp3.length).toBeGreaterThan(1_000);
  176 |     expect(mp3.some((value, index) => value === 0xff && (mp3[index + 1] & 0xe0) === 0xe0)).toBe(true);
  177 |     expect(await session.driver.findElement(By.css('[aria-live="polite"]')).getText()).toContain('Done.');
  178 |   } finally {
  179 |     await stopExtension(session);
  180 |   }
  181 | });
  182 | 
  183 | test('cancels active MP3 work and leaves no partial download', async () => {
  184 |   const session = await startExtension();
  185 |   try {
  186 |     await importAudio(session, 180);
  187 |     await chooseFormat(session.driver, 'mp3');
  188 |     await startExport(session.driver);
  189 | 
  190 |     const cancel = await session.driver.wait(
  191 |       until.elementLocated(By.xpath('//button[normalize-space()="Cancel"]')),
  192 |       10_000,
  193 |     );
  194 |     const progress = await session.driver.findElement(By.css('[role="progressbar"]'));
  195 |     expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
  196 |     await cancel.click();
  197 |     await session.driver.wait(
  198 |       until.elementTextContains(
  199 |         session.driver.findElement(By.css('[aria-live="polite"]')),
  200 |         'Export cancelled.',
  201 |       ),
  202 |       10_000,
  203 |     );
  204 |     await new Promise((resolve) => setTimeout(resolve, 1_000));
  205 |     expect(await readdir(session.downloadDirectory)).toEqual([]);
  206 |   } finally {
  207 |     await stopExtension(session);
  208 |   }
  209 | });
  210 | 
```