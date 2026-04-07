// sw.js — Service Worker for Ghost Tech OMR
// Caches all app shell assets so the app works fully offline after first load.
// Strategy: Cache-first for static assets, network-first is not needed
// since all data lives in IndexedDB on the device.

const CACHE_NAME = 'ghost-omr-v4';

// All files that make up the app shell.
// Update CACHE_NAME above whenever you deploy new versions
// so returning users get fresh files.
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/dom.js',
  './js/store.js',
  './js/omr.js',
  './js/opencv-loader.js',
  './js/warp.js',
  './js/corner-adjust.js',
  './js/calibration.js',
  './js/exams.js',
  './js/results.js',
  './js/camera.js',
  './js/app.js',
];

// Install: cache all shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // activate immediately
  );
});

// Activate: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // take control of open pages
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // Not in cache — fetch from network and cache the response
      return fetch(event.request).then(response => {
        // Only cache valid responses from our own origin
        if (
          response.ok &&
          response.type === 'basic'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
