// ============================================================
// modal.ts — Gerenciador de modal dinâmico reutilizável
// ============================================================

const MODAL_ID = 'bustracker-modal-overlay';

/**
 * Fecha e destrói o modal ativo.
 */
export function closeModal(): void {
  const existingModal = document.getElementById(MODAL_ID);
  if (existingModal) {
    // Remove o modal do DOM
    existingModal.remove();
  }
}

/**
 * Exibe um modal popup na tela.
 * 
 * @param title - O título do modal
 * @param content - O HTML ou texto contido no corpo do modal
 * @param onConfirm - Callback opcional executado ao clicar em "Confirmar"
 */
export function showModal(title: string, content: string, onConfirm?: () => void): void {
  // Garante que não há outro modal aberto antes de criar um novo
  closeModal();

  // Cria o overlay do modal
  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.className = 'modal-overlay';

  // Estrutura interna do modal
  overlay.innerHTML = `
    <div class="modal-content" id="bustracker-modal-content">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${content}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel-btn">Cancelar</button>
        ${onConfirm ? `<button class="btn btn-primary" id="modal-confirm-btn">Confirmar</button>` : ''}
      </div>
    </div>
  `;

  // Adiciona o modal ao final do body
  document.body.appendChild(overlay);

  // Fecha o modal ao clicar fora (no overlay)
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  // Listener para o botão Cancelar
  const cancelBtn = overlay.querySelector('#modal-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeModal();
    });
  }

  // Listener para o botão Confirmar (se houver)
  if (onConfirm) {
    const confirmBtn = overlay.querySelector('#modal-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        onConfirm();
        closeModal();
      });
    }
  }
}
