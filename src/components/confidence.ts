// ============================================================
// confidence.ts — Componente indicador da confiança da previsão
// ============================================================

/**
 * Renderiza o indicador visual da confiança da previsão.
 * Exibe uma barra de progresso horizontal e um rótulo de confiabilidade.
 * 
 * @param confidence - Grau de confiança entre 0 e 100
 * @param recordCount - Quantidade de registros históricos usados
 * @param reliability - Nível de confiabilidade ('none' | 'low' | 'medium' | 'high')
 * @returns String contendo o HTML estruturado
 */
export function renderConfidence(
  confidence: number,
  recordCount: number,
  reliability: string
): string {
  // Traduz o nível de confiabilidade para exibição
  let reliabilityText = 'Sem dados';
  let barColorClass = 'red';

  switch (reliability) {
    case 'high':
      reliabilityText = 'Alta';
      barColorClass = 'green';
      break;
    case 'medium':
      reliabilityText = 'Média';
      barColorClass = 'yellow';
      break;
    case 'low':
      reliabilityText = 'Baixa';
      barColorClass = 'red';
      break;
    case 'none':
    default:
      reliabilityText = 'Nenhuma';
      barColorClass = 'red';
      break;
  }

  // Formata o texto de contagem de registros
  const recordCountText = recordCount === 0
    ? 'Sem dados históricos para este horário'
    : recordCount === 1
      ? 'Baseado em 1 viagem registrada'
      : `Baseado em ${recordCount} viagens registradas`;

  return `
    <div class="confidence-container">
      <div class="confidence-header">
        <span style="font-size: 13px; font-weight: 500;">Confiança: <strong>${Math.round(confidence)}%</strong></span>
        <span class="confidence-reliability reliability-${reliability}">
          ${reliabilityText}
        </span>
      </div>
      <div class="confidence-bar-outer" style="margin: 8px 0;">
        <div class="confidence-bar-inner ${barColorClass}" style="width: ${confidence}%"></div>
      </div>
      <div style="font-size: 11px; color: var(--text-secondary);">
        ${recordCountText}
      </div>
    </div>
  `;
}
