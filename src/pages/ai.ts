// ============================================================
// ai.ts — Página do Motor de IA e Treinamento
// ============================================================

import { getAll, getById, put, getSettings } from '../db/database';
import { Preset, TripRecord, Schedule, BacktestResult } from '../types';
import { calculateBacktestResults, getLineReliabilityScore } from '../services/statistics';
import { getDefaultTimeBands } from '../services/prediction-utils';
import { timeDiffMinutes, formatDate } from '../utils/time';
import { getIcon } from '../components/icons';
import { showToast } from '../components/toast';

/**
 * Renderiza o esqueleto HTML da página de IA com o seletor de trajeto.
 * 
 * @returns String contendo o HTML básico
 */
export async function renderAiPage(): Promise<string> {
  return `
    <div class="app-header">
      <div class="app-title">Motor de IA</div>
    </div>

    <!-- Filtro por Trajeto (Preset) -->
    <div class="card" style="margin-bottom: 20px; padding: 12px 16px;">
      <label class="label" for="ai-preset-filter">Selecione o Trajeto para Análise</label>
      <select class="select" id="ai-preset-filter" style="margin-bottom: 0;">
        <option value="">Carregando trajetos...</option>
      </select>
    </div>

    <!-- Container dinâmico do painel de IA -->
    <div id="ai-page-content">
      <p style="text-align: center; padding: 24px 0;">Carregando dados da IA...</p>
    </div>
  `;
}

/**
 * Inicializa a lógica da página de IA. Popula trajetos e adiciona escuta de eventos.
 */
export async function initAiPage(): Promise<void> {
  const filterSelect = document.getElementById('ai-preset-filter') as HTMLSelectElement;
  if (!filterSelect) return;

  const [presets, settings] = await Promise.all([
    getAll<Preset>('presets'),
    getSettings()
  ]);

  if (presets.length === 0) {
    const container = document.getElementById('ai-page-content');
    if (container) {
      const brainIconSvg = getIcon('brain', 36, 'empty-state-icon');
      container.innerHTML = `
        <div class="card empty-state" style="padding: 32px 16px;">
          <div class="empty-state-icon" style="color: var(--text-secondary);">${brainIconSvg}</div>
          <div class="empty-state-title" style="margin-top: 12px;">Nenhum trajeto configurado</div>
          <div class="empty-state-desc">
            Crie um trajeto na aba "Gerenciar" para ver o motor de IA em ação.
          </div>
        </div>
      `;
    }
    filterSelect.innerHTML = '<option value="">Sem trajetos</option>';
    filterSelect.disabled = true;
    return;
  }

  // Popula o select dropdown
  filterSelect.innerHTML = '';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    filterSelect.appendChild(opt);
  });

  // Define o preset inicial (o salvo nas configurações ou o primeiro)
  const initialPresetId = settings.activePresetId && presets.some(p => p.id === settings.activePresetId)
    ? settings.activePresetId
    : presets[0].id;

  filterSelect.value = initialPresetId;

  // Renderiza inicialmente
  await renderAiContent(initialPresetId);

  // Listener para mudança de trajeto
  filterSelect.addEventListener('change', async () => {
    await renderAiContent(filterSelect.value);
  });

  // Event Delegation para reincorporar outliers
  const pageContent = document.getElementById('ai-page-content');
  if (pageContent) {
    pageContent.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('[data-action="restore-outlier"]') as HTMLButtonElement;
      
      if (button) {
        const recordId = button.getAttribute('data-id');
        if (recordId) {
          try {
            const record = await getById<TripRecord>('tripRecords', recordId);
            if (record) {
              record.isOutlier = false;
              await put('tripRecords', record);
              showToast('Viagem reincorporada ao motor de IA!', 'success');
              
              // Atualiza o conteúdo visualmente
              await renderAiContent(filterSelect.value);
            }
          } catch (err) {
            console.error('Erro ao restaurar outlier:', err);
            showToast('Erro ao reincorporar viagem.', 'error');
          }
        }
      }
    });
  }
}

/**
 * Renderiza o painel completo de detalhes de IA para um preset específico.
 */
async function renderAiContent(presetId: string): Promise<void> {
  const container = document.getElementById('ai-page-content');
  if (!container) return;

  const [presets, allRecords, schedules] = await Promise.all([
    getAll<Preset>('presets'),
    getAll<TripRecord>('tripRecords'),
    getAll<Schedule>('schedules')
  ]);

  const preset = presets.find(p => p.id === presetId);
  if (!preset) {
    container.innerHTML = '<p>Erro: Trajeto não encontrado.</p>';
    return;
  }

  // Filtra registros do preset selecionado
  const presetRecords = allRecords.filter(r => r.presetId === presetId);
  const activeSchedules = schedules.filter(s => s.lineId === preset.lineId);

  if (presetRecords.length === 0) {
    const brainIcon = getIcon('brain', 36);
    container.innerHTML = `
      <div class="card empty-state" style="padding: 32px 16px;">
        <div class="empty-state-icon" style="color: var(--text-secondary);">${brainIcon}</div>
        <div class="empty-state-title" style="margin-top: 12px;">Sem dados para este trajeto</div>
        <div class="empty-state-desc">
          O motor de IA precisa de registros de viagens para rodar os algoritmos de predição e analisar consistência. Registre uma viagem na Home!
        </div>
      </div>
    `;
    return;
  }

  // Estatísticas e Métricas da IA
  const totalTrips = presetRecords.length;
  const outlierRecords = presetRecords.filter(r => r.isOutlier);
  const outlierCount = outlierRecords.length;

  const reliabilityScore = getLineReliabilityScore(presetRecords);

  // Cor correspondente ao score de confiabilidade
  let scoreColor = 'var(--danger)';
  let scoreText = 'Instável';
  if (reliabilityScore >= 80) {
    scoreColor = 'var(--success)';
    scoreText = 'Excelente';
  } else if (reliabilityScore >= 50) {
    scoreColor = 'var(--warning)';
    scoreText = 'Moderada';
  }

  // 1. Painel "Status do Motor"
  let statusPanelHtml = `
    <div class="card" style="margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--accent); display: inline-flex;">${getIcon('brain', 18)}</span> Status do Motor de IA
      </h3>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div class="stat-card" style="background: rgba(255, 255, 255, 0.03); padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
          <div class="label" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; color: var(--text-secondary);">Viagens Registradas</div>
          <div style="font-size: 20px; font-weight: 700; margin-top: 4px;">${totalTrips}</div>
        </div>
        <div class="stat-card" style="background: rgba(255, 255, 255, 0.03); padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
          <div class="label" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; color: var(--text-secondary);">Outliers Filtrados</div>
          <div style="font-size: 20px; font-weight: 700; margin-top: 4px; color: ${outlierCount > 0 ? 'var(--warning)' : 'inherit'};">
            ${outlierCount}
          </div>
        </div>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span class="label" style="font-size: 12px; color: var(--text-secondary);">Confiabilidade do Trajeto</span>
          <span style="font-weight: 700; color: ${scoreColor}; font-size: 14px;">${reliabilityScore}/100 (${scoreText})</span>
        </div>
        <div style="width: 100%; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
          <div style="width: ${reliabilityScore}%; height: 100%; background: ${scoreColor}; border-radius: 4px; transition: width 0.5s ease;"></div>
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px; line-height: 1.4;">
          Calculado com base na variação dos atrasos históricos. Quanto menor o desvio padrão das viagens, mais previsível e confiável é o horário do ônibus.
        </p>
      </div>
    </div>
  `;

  // 2. Painel "Faixas Horárias"
  const defaultBands = getDefaultTimeBands();
  const bandColors: Record<string, string> = {
    dawn: 'rgba(139, 92, 246, 0.15)',      // Roxo
    morning_rush: 'rgba(239, 68, 68, 0.15)',  // Vermelho
    midday: 'rgba(245, 158, 11, 0.15)',       // Laranja/Amarelo
    evening_rush: 'rgba(236, 72, 153, 0.15)', // Rosa
    night: 'rgba(59, 130, 246, 0.15)',       // Azul
  };
  const bandTextColors: Record<string, string> = {
    dawn: '#c084fc',
    morning_rush: '#f87171',
    midday: '#fbbf24',
    evening_rush: '#f472b6',
    night: '#60a5fa',
  };

  const formatMinutesToTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  let bandsHtml = `
    <div class="card" style="margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--accent); display: inline-flex;">${getIcon('filter', 18)}</span> Faixas de Sazonalidade
      </h3>
      <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.4;">
        O motor de IA agrupa as viagens nessas faixas horárias para compensar os horários de pico automaticamente:
      </p>
      
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${defaultBands.map(b => {
          const bg = bandColors[b.band] || 'rgba(255, 255, 255, 0.05)';
          const textCol = bandTextColors[b.band] || 'var(--text)';
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius);">
              <span style="font-weight: 600; font-size: 13px;">${b.label}</span>
              <span class="badge" style="background: ${bg}; color: ${textCol}; font-size: 11px; padding: 4px 8px; font-family: monospace;">
                ${formatMinutesToTime(b.startMinute)} - ${formatMinutesToTime(b.endMinute)}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // 3. Gráfico de Backtesting "Previsão vs Realidade"
  let backtestingHtml = '';
  const backtestResults = calculateBacktestResults(presetRecords, preset, activeSchedules);

  if (backtestResults.length === 0) {
    backtestingHtml = `
      <div class="card" style="margin-bottom: 20px;">
        <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--accent); display: inline-flex;">${getIcon('lineChart', 18)}</span> Previsão vs Realidade (Backtesting)
        </h3>
        <div style="text-align: center; padding: 24px 8px; border: 1px dashed var(--border); border-radius: var(--radius); color: var(--text-secondary); font-size: 12px;">
          Dados insuficientes para simular acurácia. Registre pelo menos 5 viagens para calibrar o gráfico.
        </div>
      </div>
    `;
  } else {
    // Calcula acurácia (erro <= 3 minutos)
    const totalBacktests = backtestResults.length;
    const hits = backtestResults.filter(r => r.wasAccurate).length;
    const accuracyPct = Math.round((hits / totalBacktests) * 100);

    // Configurações do SVG
    const width = 400;
    const height = 200;
    const paddingLeft = 36;
    const paddingRight = 16;
    const paddingTop = 28;
    const paddingBottom = 28;
    const graphWidth = width - paddingLeft - paddingRight;
    const graphHeight = height - paddingTop - paddingBottom;

    // Acha limites de erro dinamicamente (com mínimo de -10 a 10)
    let maxError = 10;
    let minError = -10;
    backtestResults.forEach(r => {
      const diff = r.actualOffset - r.predictedOffset;
      if (diff > maxError) maxError = diff;
      if (diff < minError) minError = diff;
    });

    // Mapeamento linear para Y do SVG (maxError fica no topo y=paddingTop, minError fica embaixo y=height-paddingBottom)
    const getSvgY = (diffVal: number) => {
      return paddingTop + ((maxError - diffVal) * graphHeight) / (maxError - minError);
    };

    // Mapeamento para X
    const getSvgX = (idx: number) => {
      if (totalBacktests === 1) return paddingLeft + graphWidth / 2;
      return paddingLeft + (idx * graphWidth) / (totalBacktests - 1);
    };

    // Linha Zero (Previsão perfeita)
    const yZero = getSvgY(0);

    // Monta o path da linha que conecta os pontos
    let linePathD = '';
    backtestResults.forEach((r, idx) => {
      const diff = r.actualOffset - r.predictedOffset;
      const x = getSvgX(idx);
      const y = getSvgY(diff);
      if (idx === 0) {
        linePathD += `M ${x} ${y}`;
      } else {
        linePathD += ` L ${x} ${y}`;
      }
    });

    // Círculos dos dados
    const circlesHtml = backtestResults.map((r, idx) => {
      const diff = r.actualOffset - r.predictedOffset;
      const x = getSvgX(idx);
      const y = getSvgY(diff);
      const color = Math.abs(diff) <= 3 ? 'var(--success)' : 'var(--danger)';
      const tooltipText = `Dia ${formatDate(r.date)}: real ${r.actualOffset}m, previst ${r.predictedOffset}m. Erro: ${diff}m`;
      
      return `
        <circle cx="${x}" cy="${y}" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="1.5">
          <title>${tooltipText}</title>
        </circle>
      `;
    }).join('');

    backtestingHtml = `
      <div class="card" style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--accent); display: inline-flex;">${getIcon('lineChart', 18)}</span> Previsão vs Realidade
          </h3>
          <span style="font-weight: 700; color: ${accuracyPct >= 75 ? 'var(--success)' : 'var(--warning)'}; font-size: 15px;">
            ${accuracyPct}% Acurácia
          </span>
        </div>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.4;">
          Precisão simulada retroativamente (margem de erro de ±3 minutos).
          Pontos acima de zero indicam que o ônibus chegou mais tarde que o previsto; pontos abaixo indicam que chegou mais cedo.
        </p>

        <!-- SVG do Gráfico -->
        <div style="background: rgba(0,0,0,0.15); border-radius: var(--radius); padding: 8px; border: 1px solid var(--border);">
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; overflow: visible;">
            <!-- Grid de fundo horizontal -->
            <line x1="${paddingLeft}" y1="${paddingTop}" x2="${width - paddingRight}" y2="${paddingTop}" stroke="var(--border)" opacity="0.3" stroke-width="0.5" />
            <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="var(--border)" opacity="0.3" stroke-width="0.5" />
            
            <!-- Linha Zero (Previsão perfeita) -->
            <line x1="${paddingLeft}" y1="${yZero}" x2="${width - paddingRight}" y2="${yZero}" stroke="var(--text-secondary)" stroke-dasharray="3,3" opacity="0.6" stroke-width="1.2" />
            
            <!-- Labels Eixo Y -->
            <text x="${paddingLeft - 8}" y="${paddingTop + 4}" font-size="9" fill="var(--text-secondary)" text-anchor="end">${maxError > 0 ? '+' : ''}${maxError.toFixed(0)}m</text>
            <text x="${paddingLeft - 8}" y="${yZero + 3}" font-size="9" fill="var(--text-secondary)" text-anchor="end">Ideal</text>
            <text x="${paddingLeft - 8}" y="${height - paddingBottom + 3}" font-size="9" fill="var(--text-secondary)" text-anchor="end">${minError.toFixed(0)}m</text>
            
            <!-- Caminho temporal da linha -->
            <path d="${linePathD}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.35" />
            
            <!-- Desenho dos pontos (círculos) -->
            ${circlesHtml}

            <!-- Labels Eixo X -->
            <text x="${paddingLeft}" y="${height - 8}" font-size="9" fill="var(--text-secondary)" text-anchor="start">Mais antiga</text>
            <text x="${width - paddingRight}" y="${height - 8}" font-size="9" fill="var(--text-secondary)" text-anchor="end">Recente</text>
          </svg>
        </div>
      </div>
    `;
  }

  // 4. Painel explicativo "Como a IA Pensa"
  const explanationHtml = `
    <div class="card" style="margin-bottom: 20px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--accent); display: inline-flex;">${getIcon('helpCircle', 18)}</span> Como a IA Pensa (Fatores)
      </h3>
      <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.4;">
        Para calcular o horário previsto, o algoritmo analisa todo o histórico aplicando os seguintes pesos matemáticos:
      </p>

      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text);">1. Recência (Tempo)</span>
            <span style="font-size: 12px; color: var(--text-secondary);">Decai 5% ao dia</span>
          </div>
          <div style="width: 100%; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
            <div style="width: 80%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.3;">
            Registros novos têm alta prioridade. Viagens ocorridas há 30 dias perdem ~80% do peso de influência no cálculo.
          </p>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text);">2. Dia da Semana</span>
            <span style="font-size: 12px; color: var(--text-secondary);">Bônus de 1.0x a 0.1x</span>
          </div>
          <div style="width: 100%; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
            <div style="width: 90%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.3;">
            O tráfego de segunda-feira é diferente do de domingo. Viagens no mesmo dia da semana têm peso máximo.
          </p>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text);">3. Horário e Faixa</span>
            <span style="font-size: 12px; color: var(--text-secondary);">Janela de 1h + Bônus de Faixa</span>
          </div>
          <div style="width: 100%; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
            <div style="width: 75%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.3;">
            Horários próximos têm prioridade. Além disso, viagens na mesma faixa horária (ex: Rush) ganham 1.5x de bônus.
          </p>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text);">4. Tendência (Regressão)</span>
            <span style="font-size: 12px; color: var(--text-secondary);">Influência de 30% se estável</span>
          </div>
          <div style="width: 100%; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
            <div style="width: 50%; height: 100%; background: var(--accent); border-radius: 3px;"></div>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.3;">
            Calcula se o ônibus está ficando mais lento nos últimos 14 dias. Se houver tendência clara, projeta essa variação.
          </p>
        </div>
      </div>
    </div>
  `;

  // 5. Gerenciador de Outliers (Anomalias)
  let outlierHtml = '';
  if (outlierCount === 0) {
    outlierHtml = `
      <div class="card" style="margin-bottom: 20px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--accent); display: inline-flex;">${getIcon('alertTriangle', 18)}</span> Gerenciador de Outliers
        </h3>
        <div style="text-align: center; padding: 20px 8px; border: 1px dashed var(--border); border-radius: var(--radius); color: var(--text-secondary); font-size: 12px;">
          Nenhum outlier detectado para este trajeto. O motor está usando 100% dos dados registrados.
        </div>
      </div>
    `;
  } else {
    outlierHtml = `
      <div class="card" style="margin-bottom: 20px;">
        <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--accent); display: inline-flex;">${getIcon('alertTriangle', 18)}</span> Gerenciador de Outliers
        </h3>
        <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.4;">
          Viagens com atrasos anômalos (calculados via IQR ou marcados como inválidos) são ignorados pelo motor para evitar previsões distorcidas.
        </p>

        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 250px; overflow-y: auto; padding-right: 4px;">
          ${outlierRecords.map(r => {
            const delay = timeDiffMinutes(r.scheduledDeparture, r.busArrivedAt);
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: var(--radius);">
                <div>
                  <div style="font-size: 12px; font-weight: 600; color: var(--text);">${formatDate(r.date)}</div>
                  <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                    Programado: ${r.scheduledDeparture} | Chegada: ${r.busArrivedAt}
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-size: 12px; font-weight: 700; color: var(--danger); font-family: monospace;">
                    ${delay > 0 ? '+' : ''}${delay} min
                  </span>
                  <button class="btn btn-secondary" data-action="restore-outlier" data-id="${r.id}" style="padding: 4px 8px; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
                    Reincorporar
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Junta tudo no container principal
  container.innerHTML = `
    ${statusPanelHtml}
    ${backtestingHtml}
    ${bandsHtml}
    ${explanationHtml}
    ${outlierHtml}
  `;
}
