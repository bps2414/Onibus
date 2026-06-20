// ============================================================
// theme-toggle.ts — Alternador de temas Light/Dark
// ============================================================

import { getSettings, saveSettings } from '../db/database';
import { showToast } from './toast';

/**
 * Renderiza o botão HTML do alternador de temas.
 * 
 * @returns String contendo o HTML do botão de tema
 */
export function renderThemeToggle(): string {
  return `
    <button class="theme-btn" id="theme-toggle-btn" title="Alternar tema" aria-label="Alternar tema">
      🌙
    </button>
  `;
}

/**
 * Aplica o tema visual no elemento HTML raiz do documento.
 * 
 * @param theme - O tema a ser aplicado ('dark' | 'light')
 */
export function applyThemeToDocument(theme: 'dark' | 'light'): void {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme'); // Dark é o padrão
  }
}

/**
 * Inicializa os event listeners e atualiza o estado visual do botão do tema.
 */
export async function initThemeToggle(): Promise<void> {
  const button = document.getElementById('theme-toggle-btn');
  if (!button) return;

  // Recupera as configurações de IndexedDB
  const settings = await getSettings();
  const currentTheme = settings.theme || 'dark';

  // Atualiza o ícone do botão com base no tema ativo
  button.innerHTML = currentTheme === 'light' ? '🌙' : '☀️';

  // Adiciona o listener para alternar entre claro e escuro
  button.addEventListener('click', async () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const nextTheme = isLight ? 'dark' : 'light';

    // Aplica o novo tema no DOM
    applyThemeToDocument(nextTheme);

    // Salva a preferência nas configurações
    await saveSettings({ theme: nextTheme });

    // Atualiza o ícone visual
    button.innerHTML = nextTheme === 'light' ? '🌙' : '☀️';

    // Exibe um toast de confirmação
    showToast(`Tema alterado para modo ${nextTheme === 'dark' ? 'escuro' : 'claro'}!`, 'success');
  });
}
