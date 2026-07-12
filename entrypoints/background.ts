export default defineBackground(() => {
  browser.action.onClicked.addListener(async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('/app.html') });
  });
});
