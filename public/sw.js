// ============================================================
// sw.js — Service Worker do PWA para suporte offline
// ============================================================

const CACHE_NAME = 'bustracker-cache-v1';

// Recursos básicos a serem cacheados imediatamente ao instalar o app
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/src/main.ts',
  '/src/styles/global.css',
  '/favicon.ico',
  '/manifest.json'
];

// Instala o service worker e pré-cacha os recursos básicos
self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[BusTracker PWA] Falha ao pré-cachear alguns assets (comum em modo Dev):', err);
      });
    })
  );
  // Força o Service Worker ativo a assumir o controle imediatamente
  (self as any).skipWaiting();
});

// Ativa e limpa caches antigos se a versão mudar
self.addEventListener('activate', (event: any) => {
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
  (self as any).clients.claim();
});

// Intercepta as requisições de rede
// Estratégia: Network First, com Fallback para Cache.
// Isso garante que você sempre tenha o código mais recente online, mas abra offline se não tiver internet.
self.addEventListener('fetch', (event: any) => {
  // Apenas intercepta requisições HTTP/S locais (ignora chrome-extensions, etc.)
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a resposta for válida, faz uma cópia no cache dinâmico
        if (response && response.status === 200 && response.type === 'basic') {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseCopy);
          });
        }
        return response;
      })
      .catch(() => {
        // Se falhar a rede (offline), busca no cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // Se não achar nada no cache e for uma navegação de página, retorna o index.html principal
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/');
          }
          
          // Caso contrário, falha silenciosamente
          return new Response('Sem conexão com a internet e sem dados no cache.', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});
