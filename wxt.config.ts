import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Media Tools',
    description: 'Cut and export audio with local processing and no upload.',
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
        "object-src 'self'",
        "base-uri 'none'",
      ].join('; '),
    },
    browser_specific_settings: {
      gecko: {
        id: 'media-tools@local',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
