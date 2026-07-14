import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  zip: {
    // Name the packaged artifacts after the product (audio-cutter-<version>-<browser>.zip)
    // without renaming the package, which would move the /media-tools/ Pages path.
    name: 'audio-cutter',
  },
  manifest: ({ browser }) => ({
    name: 'Audio Cutter',
    description: 'Private, offline audio cutting for Firefox and Chrome, entirely in your browser.',
    permissions: [],
    action: {},
    content_security_policy: {
      extension_pages: [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "worker-src 'self'",
        "connect-src 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; '),
    },
    // browser_specific_settings.gecko is Firefox-only; emitting it in the Chrome
    // build triggers an "unrecognized manifest key" warning, so gate it by target.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'audiocutter@animesh.kundus.in',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
    // Disable Vite's module-preload polyfill so the built bundle contains no
    // fetch() shim. Modern Chrome and Firefox support modulepreload natively.
    build: { modulePreload: { polyfill: false } },
  }),
});
