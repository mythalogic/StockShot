import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'StockShot',
        short_name: 'StockShot',
        description: 'Product + barcode photo capture for stocktake teams',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        theme_color: '#191B1E',
        background_color: '#F4F4EF',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },

      // ONE workbox block only. Two of them means the second silently wins.
      workbox: {
        // App shell + the 4.7MB segmentation model are precached at install, so
        // capture works with no signal. Storage uploads still need connectivity.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,onnx}'],

        // The onnxruntime .wasm files are 10-20MB each — far too big to precache.
        // They're handled by runtimeCaching below instead.
        globIgnores: ['**/ort/**'],

        navigateFallback: '/index.html',

        // Default is 2MB, which would silently skip u2netp.onnx (4.7MB) and
        // leave you with an app that works online and mysteriously fails offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,

        runtimeCaching: [
          {
            // Cache the WebAssembly runtime the first time it's actually used,
            // then serve it from cache forever. Keeps the install light while
            // still working offline from the second launch onwards.
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnxruntime-wasm',
              expiration: {
                maxEntries: 12,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
})
