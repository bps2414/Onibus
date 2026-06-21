// ============================================================
// sw.js — Service Worker do PWA para suporte offline
// ============================================================

const CACHE_NAME = 'bustracker-cache-v2';

// Recursos mínimos estáticos conhecidos que sempre existem
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/manifest.json'
];

// Instala o service worker e pré-cacha os recursos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[BusTracker PWA] Falha ao pré-cachear assets estáticos iniciais:', err);
      });
    })
  );
  // Força o Service Worker ativo a assumir o controle imediatamente
  self.skipWaiting();
});

// Ativa e limpa caches antigos se a versão mudar
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[BusTracker PWA] Apagando cache antigo:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercepta requisições
// Estratégia: Network First com Fallback para Cache.
// Assim, se houver rede, pegamos as atualizações mais recentes e atualizamos o cache.
// Se estiver offline ou a rede falhar, servimos a versão do cache imediatamente.
self.addEventListener('fetch', (event) => {
  // Apenas intercepta requisições HTTP/S locais
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Ignora requisições de desenvolvimento do Vite (HMR) e node_modules
  if (
    event.request.url.includes('/@vite/') || 
    event.request.url.includes('/@fs/') || 
    event.request.url.includes('/node_modules/')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a resposta for válida, coloca uma cópia no cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseCopy);
          });
        }
        return response;
      })
      .catch(() => {
        // Falhou a rede (offline), busca no cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // Se for navegação de página html e não achar nada, retorna a raiz /
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/');
          }
          
          return new Response('Sem conexão com a internet e sem dados no cache.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
          });
        });
      })
  );
});
