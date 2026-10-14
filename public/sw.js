const CACHE = 'gallivanter-v1'
const ASSETS = [
  '/',
  '/index.html',
  '/gallivanter.css',
  '/gallivanter.js',
  '/zoho-ui-architecture.css',
  '/zoho-ui-architecture.html',
  '/zoho-ui-architecture.js',
  '/manifest.json',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  )
})

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  )
})