// ============================================================
// sw.js — Service Worker do PWA para suporte offline e alarmes
// ============================================================

const CACHE_NAME = 'borabus-cache-v2';

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
        console.warn('[BoraBus PWA] Falha ao pré-cachear assets estáticos iniciais:', err);
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
            console.log('[BoraBus PWA] Apagando cache antigo:', name);
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

// ─── LÓGICA DE ALARMES EM SEGUNDO PLANO ──────────────────────────────────────

// Dicionário para gerenciar temporizadores ativos
const activeAlarms = {};

// Escuta mensagens vindas do frontend (home.ts)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  const { type, id, delayMs, title, body } = data;

  if (type === 'SCHEDULE_ALARM') {
    // 1. Limpa o alarme anterior se já existir um para o mesmo ID
    if (activeAlarms[id]) {
      clearTimeout(activeAlarms[id]);
      delete activeAlarms[id];
      console.log(`[BoraBus SW] Alarme cancelado para reagendamento: ${id}`);
    }

    // 2. Cria um novo temporizador
    if (delayMs > 0) {
      console.log(`[BoraBus SW] Agendando alarme para ${id} em ${delayMs}ms`);
      activeAlarms[id] = setTimeout(() => {
        // Dispara a notificação de forma nativa
        self.registration.showNotification(title, {
          body: body,
          icon: '/icons/icon-192.png',
          vibrate: [200, 100, 200, 100, 300], // Vibração personalizada
          tag: 'borabus-alert', // Substitui alertas anteriores se houver
          data: { presetId: id }
        });
        
        // Remove da lista de ativos
        delete activeAlarms[id];
        console.log(`[BoraBus SW] Alarme disparado e limpo: ${id}`);
      }, delayMs);
    }
  } 
  
  else if (type === 'CANCEL_ALARM') {
    if (activeAlarms[id]) {
      clearTimeout(activeAlarms[id]);
      delete activeAlarms[id];
      console.log(`[BoraBus SW] Alarme cancelado: ${id}`);
    }
  }
});

// Escuta o clique na notificação para focar no app
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Fecha o banner da notificação

  // Abre ou foca a janela do aplicativo
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
