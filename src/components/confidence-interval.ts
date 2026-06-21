// ============================================================
// confidence-interval.ts — Componente visual do intervalo de confiança
// Mostra uma barra de range com limites inferior/superior
// ============================================================

import type { ConfidenceInterval } from '../types'

/**
 * Renderiza a barra visual do intervalo de confiança.
 * Cores: verde (spread < 5min), amarelo (5-10min), vermelho (> 10min).
 * Mostra horário central e limites.
 *
 * @param predicted - Horário previsto HH:MM
 * @param interval - Objeto com lowerBound, upperBound e spreadMinutes
 * @returns HTML string do componente
 */
export function renderConfidenceInterval(
  predicted: string,
  interval: ConfidenceInterval
): string {
  // Determina cor baseada na largura do intervalo
  let barColor: string
  let barBgColor: string
  let label: string

  if (interval.spreadMinutes <= 6) {
    // Intervalo estreito = previsão precisa
    barColor = 'var(--success)'
    barBgColor = 'rgba(34, 197, 94, 0.15)'
    label = 'Alta precisão'
  } else if (interval.spreadMinutes <= 12) {
    // Intervalo médio
    barColor = 'var(--warning)'
    barBgColor = 'rgba(234, 179, 8, 0.15)'
    label = 'Precisão moderada'
  } else {
    // Intervalo largo = muita incerteza
    barColor = 'var(--danger)'
    barBgColor = 'rgba(239, 68, 68, 0.15)'
    label = 'Alta incerteza'
  }

  // Calcula a posição visual do marcador central (ponto previsto)
  // O marcador fica no centro da barra
  const halfSpread = interval.spreadMinutes / 2

  return `
    <div class="ci-container" style="
      background: ${barBgColor};
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 10px;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em;">
          Intervalo de Confiança
        </span>
        <span style="font-size: 12px; font-weight: 600; color: ${barColor};">
          ${label} (±${halfSpread}min)
        </span>
      </div>

      <!-- Barra visual do range -->
      <div style="position: relative; height: 28px; margin-bottom: 6px;">
        <!-- Fundo da barra -->
        <div style="
          position: absolute;
          top: 10px;
          left: 0;
          right: 0;
          height: 8px;
          background: var(--border);
          border-radius: 4px;
          overflow: hidden;
        ">
          <!-- Preenchimento colorido -->
          <div style="
            position: absolute;
            top: 0;
            left: 10%;
            right: 10%;
            height: 100%;
            background: ${barColor};
            border-radius: 4px;
            opacity: 0.6;
            transition: all 0.3s ease;
          "></div>
        </div>

        <!-- Marcador central (previsão) -->
        <div style="
          position: absolute;
          top: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 20px;
          background: ${barColor};
          border-radius: 50%;
          border: 3px solid var(--surface);
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          z-index: 1;
        "></div>
      </div>

      <!-- Limites e valor central -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">
          ${interval.lowerBound}
        </span>
        <span style="font-size: 15px; font-weight: 700; color: var(--text);">
          ~${predicted}
        </span>
        <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">
          ${interval.upperBound}
        </span>
      </div>
    </div>
  `
}

/**
 * Renderiza o badge de tendência inline.
 * Mostra ícone de seta com direção e cor.
 *
 * @param direction - Direção da tendência
 * @param strength - Força do R² (0-1)
 * @returns HTML string do badge
 */
export function renderTrendBadge(
  direction: 'rising' | 'falling' | 'stable' | 'insufficient',
  strength: number
): string {
  let arrow: string
  let color: string
  let text: string

  switch (direction) {
    case 'rising':
      arrow = '↗'
      color = 'var(--danger)'
      text = 'Atrasos subindo'
      break
    case 'falling':
      arrow = '↘'
      color = 'var(--success)'
      text = 'Atrasos caindo'
      break
    case 'stable':
      arrow = '→'
      color = 'var(--text-secondary)'
      text = 'Estável'
      break
    case 'insufficient':
    default:
      arrow = '—'
      color = 'var(--text-secondary)'
      text = 'Sem dados'
      break
  }

  // Só mostra a força se for significativa
  const strengthText = strength > 0.3 ? ` (${Math.round(strength * 100)}%)` : ''

  return `
    <span style="
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 600;
      color: ${color};
      padding: 2px 8px;
      background: ${color}15;
      border-radius: 6px;
    ">
      <span style="font-size: 14px;">${arrow}</span>
      ${text}${strengthText}
    </span>
  `
}

/**
 * Renderiza o badge de outliers filtrados.
 * Só aparece quando outliers foram detectados.
 *
 * @param count - Número de outliers filtrados
 * @returns HTML string do badge, ou string vazia se count === 0
 */
export function renderOutlierBadge(count: number): string {
  if (count === 0) return ''

  return `
    <span style="
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      font-weight: 600;
      color: var(--warning);
      padding: 2px 6px;
      background: rgba(234, 179, 8, 0.1);
      border-radius: 4px;
    ">
      ⚠ ${count} outlier${count > 1 ? 's' : ''} filtrado${count > 1 ? 's' : ''}
    </span>
  `
}
