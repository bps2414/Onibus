// ============================================================
// navbar.ts — Componente da barra de navegação inferior
// ============================================================

/**
 * Renderiza o HTML da barra de navegação inferior fixada.
 * A barra possui 4 abas: Home, Gerenciar, Histórico e Estatísticas.
 * 
 * @param activePage - O identificador da página ativa ('home', 'manage', 'history', 'stats')
 * @returns String contendo o HTML estruturado da navbar
 */
export function renderNavbar(activePage: string): string {
  // Define os itens da barra com seu respectivo hash, ícone emoji e título
  const navItems = [
    { id: 'home', hash: '#home', icon: '🏠', label: 'Home' },
    { id: 'manage', hash: '#manage', icon: '⚙️', label: 'Gerenciar' },
    { id: 'history', hash: '#history', icon: '📋', label: 'Histórico' },
    { id: 'stats', hash: '#stats', icon: '📊', label: 'Stats' }
  ];

  // Gera o HTML concatenando os itens e marcando a classe ativa apropriadamente
  const itemsHtml = navItems
    .map(item => {
      const isActive = activePage === item.id ? 'active' : '';
      return `
        <a href="${item.hash}" class="navbar-item ${isActive}" data-page="${item.id}">
          <span class="navbar-item-icon">${item.icon}</span>
          <span>${item.label}</span>
        </a>
      `;
    })
    .join('');

  return `
    <nav class="navbar">
      ${itemsHtml}
    </nav>
  `;
}
