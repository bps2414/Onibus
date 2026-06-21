// ============================================================
// main.ts — Ponto de Entrada do Aplicativo e Roteador Hash
// ============================================================

import { initDB, getSettings } from './db/database';
import { renderNavbar } from './components/navbar';
import { renderHomePage, initHomePage } from './pages/home';
import { renderManagePage, initManagePage } from './pages/manage';
import { renderHistoryPage, initHistoryPage } from './pages/history';
import { renderStatsPage, initStatsPage } from './pages/stats';
import { renderAiPage, initAiPage } from './pages/ai';
import { initThemeToggle, applyThemeToDocument } from './components/theme-toggle';



/**
 * Executa a navegação de páginas baseado no hash URL.
 * 
 * @param hash - O hash URL atual da janela (ex: "#home")
 */
async function navigate(hash: string) {
  // Limpa o timer do countdown ativo ao sair da home
  if ((window as any).busTrackerCountdownInterval) {
    clearInterval((window as any).busTrackerCountdownInterval);
    (window as any).busTrackerCountdownInterval = null;
  }

  const app = document.getElementById('app');
  if (!app) return;

  // Determina a página alvo (home é a padrão)
  const page = hash.replace('#', '') || 'home';

  let html = '';
  
  // Renderiza o HTML estático correspondente
    switch (page) {
    case 'home':
      html = await renderHomePage();
      break;
    case 'manage':
      html = await renderManagePage();
      break;
    case 'history':
      html = await renderHistoryPage();
      break;
    case 'stats':
      html = await renderStatsPage();
      break;
    case 'ai':
      html = await renderAiPage();
      break;
    default:
      html = await renderHomePage();
      break;
  }

  // Atualiza o DOM e adiciona a barra de navegação correspondente
  app.innerHTML = `<div class="page-content" data-page="${page}">${html}</div>` + renderNavbar(page);

  // Inicializa a lógica interativa (event listeners) da página ativa
  switch (page) {
    case 'home':
      await initHomePage();
      break;
    case 'manage':
      await initManagePage();
      break;
    case 'history':
      await initHistoryPage();
      break;
    case 'stats':
      await initStatsPage();
      break;
    case 'ai':
      await initAiPage();
      break;
    default:
      await initHomePage();
      break;
  }

  // Inicializa a lógica de tema (anexa eventos do toggle)
  initThemeToggle();
}

/**
 * Registra o Service Worker do PWA se suportado pelo navegador e em produção.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[BusTracker PWA] Service Worker registrado com sucesso no escopo:', reg.scope);
        })
        .catch((err) => {
          console.error('[BusTracker PWA] Falha ao registrar o Service Worker:', err);
        });
    });
  }
}

// Escuta o evento de instalação do PWA
window.addEventListener('beforeinstallprompt', (e) => {
  // Impede o prompt nativo imediato
  e.preventDefault();
  // Guarda o evento para uso na tela Home
  (window as any).deferredPrompt = e;
  
  // Dispara evento global para avisar a Home caso ela já esteja ativa
  window.dispatchEvent(new CustomEvent('can-install-pwa'));
});

/**
 * Inicialização (Bootstrap) do aplicativo.
 * Garante que o IndexedDB está pronto e o tema está aplicado antes de desenhar a tela.
 */
async function bootstrap() {
  try {
    // Inicializa o IndexedDB local
    await initDB();

    // Aplica o tema salvo antes do carregamento visual para evitar flashes brancos na tela
    const settings = await getSettings();
    const currentTheme = settings.theme || 'dark';
    applyThemeToDocument(currentTheme);

    // Registra listeners de rotas
    window.addEventListener('hashchange', () => navigate(window.location.hash));

    // Navega para a página inicial baseada no hash da URL ao abrir o app
    await navigate(window.location.hash);

    // Registra o Service Worker do PWA
    registerServiceWorker();
  } catch (err) {
    console.error('[BusTracker] Erro crítico ao inicializar o aplicativo:', err);
  }
}

// Inicializa a aplicação
bootstrap();
