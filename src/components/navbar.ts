// ============================================================
// navbar.ts — Componente da barra de navegação inferior
// ============================================================

import { getIcon } from './icons';

/**
 * Renderiza o HTML da barra de navegação inferior fixada.
 * A barra possui 5 abas: Home, Gerenciar, Histórico, Estatísticas e IA.
 * 
 * @param activePage - O identificador da página ativa ('home', 'manage', 'history', 'stats', 'ai')
 * @returns String contendo o HTML estruturado da navbar
 */
export function renderNavbar(activePage: string): string {
  // Define os itens da barra com seu respectivo hash, ícone e título
  const navItems = [
    { id: 'home', hash: '#home', iconName: 'home', label: 'Início' },
    { id: 'manage', hash: '#manage', iconName: 'manage', label: 'Gerenciar' },
    { id: 'history', hash: '#history', iconName: 'history', label: 'Histórico' },
    { id: 'stats', hash: '#stats', iconName: 'stats', label: 'Stats' },
    { id: 'ai', hash: '#ai', iconName: 'brain', label: 'IA' }
  ];

  // Gera o HTML concatenando os itens e marcando a classe ativa apropriadamente
  const itemsHtml = navItems
    .map(item => {
      const isActive = activePage === item.id ? 'active' : '';
      const iconSvg = getIcon(item.iconName, 20);
      return `
        <a href="${item.hash}" class="navbar-item ${isActive}" data-page="${item.id}">
          <span class="navbar-item-icon">${iconSvg}</span>
          <span class="navbar-item-label">${item.label}</span>
        </a>
      `;
    })
    .join('');

  return `
    <nav class="navbar">
      <div class="navbar-items-wrapper">
        ${itemsHtml}
      </div>
    </nav>
  `;
}

