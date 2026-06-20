// ============================================================
// countdown.ts — Componente visual do contador regressivo
// ============================================================

/**
 * Renderiza um display visual grande para o tempo restante em minutos.
 * 
 * @param minutes - Minutos restantes até a chegada do ônibus
 * @returns String contendo o HTML estruturado do countdown
 */
export function renderCountdown(minutes: number): string {
  // Determina a classe de cor com base nos limites definidos
  let colorClass = 'green';
  if (minutes < 5) {
    colorClass = 'red';
  } else if (minutes <= 10) {
    colorClass = 'yellow';
  }

  // Formata o texto do tempo restante
  let displayValue = '';
  if (minutes < 0) {
    displayValue = 'Passou';
  } else if (minutes === 0) {
    displayValue = 'Agora!';
  } else if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    displayValue = `${hours}h ${remainingMinutes}min`;
  } else {
    displayValue = `${minutes} min`;
  }

  return `
    <div class="countdown-wrapper">
      <div class="countdown ${colorClass}">
        ${displayValue}
      </div>
      <div class="label" style="margin-top: 8px; margin-bottom: 0;">Tempo Estimado</div>
    </div>
  `;
}
