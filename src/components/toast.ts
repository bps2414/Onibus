// ============================================================
// toast.ts — Sistema de notificações toast flutuantes
// ============================================================

const CONTAINER_ID = 'bustracker-toast-container';

/**
 * Exibe uma notificação toast temporária no topo da tela.
 * 
 * @param message - A mensagem de texto a ser exibida
 * @param type - O tipo do toast ('success' | 'error' | 'info')
 */
export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info'
): void {
  // Localiza ou cria o container de toasts no body
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  // Cria a div individual do toast
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Define os ícones por tipo de notificação
  let icon = 'ℹ️';
  switch (type) {
    case 'success':
      icon = '✅';
      break;
    case 'error':
      icon = '⚠️';
      break;
    case 'info':
    default:
      icon = 'ℹ️';
      break;
  }

  // Preenche o HTML do toast
  toast.innerHTML = `
    <span style="font-size: 16px;">${icon}</span>
    <span>${message}</span>
  `;

  // Adiciona ao container
  container.appendChild(toast);

  // Agenda a animação de saída (fade-out) em 2.7 segundos (2700ms)
  setTimeout(() => {
    toast.classList.add('fade-out');
  }, 2700);

  // Remove o elemento completamente após 3 segundos (3000ms)
  setTimeout(() => {
    toast.remove();
    // Limpa o container se não houver mais toasts ativos
    if (container && container.childElementCount === 0) {
      container.remove();
    }
  }, 3000);
}
