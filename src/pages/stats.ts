// ============================================================
// stats.ts — Página de Estatísticas e Análise de Desempenho
// ============================================================

import { getAll, getSchedulesByLine, getSettings } from '../db/database';
import { TripRecord, Preset, Schedule, BusLine } from '../types';
import { calculateOverallStats, calculatePredictionAccuracy } from '../services/statistics';
import { formatMinutes } from '../utils/time';
import { getIcon } from '../components/icons';

/**
 * Renderiza o esqueleto HTML da página de estatísticas com filtro de trajeto.
 * 
 * @returns String contendo o HTML básico
 */
export async function renderStatsPage(): Promise<string> {
  return `
    <div class="app-header">
      <div class="app-title">Estatísticas</div>
    </div>

    <!-- Filtro por Trajeto -->
    <div class="card" style="margin-bottom: 20px; padding: 12px 16px;">
      <label class="label" for="stats-preset-filter">Análise de Trajeto</label>
      <select class="select" id="stats-preset-filter" style="margin-bottom: 0;">
        <option value="all">Visão Geral (Todos os Trajetos)</option>
      </select>
    </div>

    <!-- Container dinâmico das estatísticas -->
    <div id="stats-page-content">
      <p style="text-align: center; padding: 24px 0;">Carregando estatísticas...</p>
    </div>
  `;
}

/**
 * Inicializa a lógica da página de estatísticas, gerenciando carregamento e filtros.
 */
export async function initStatsPage(): Promise<void> {
  const filterSelect = document.getElementById('stats-preset-filter') as HTMLSelectElement;
  if (!filterSelect) return;

  const presets = await getAll<Preset>('presets');

  // Popula o dropdown com trajetos configurados
  filterSelect.innerHTML = '<option value="all">Visão Geral (Todos os Trajetos)</option>';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    filterSelect.appendChild(opt);
  });

  // Atualiza as estatísticas inicialmente
  await renderStatsContent('all');

  // Adiciona listener para recalcular e renderizar ao alterar filtro
  filterSelect.addEventListener('change', async () => {
    await renderStatsContent(filterSelect.value);
  });
}

/**
 * Realiza os cálculos estatísticos com base no filtro selecionado e renderiza o conteúdo.
 * 
 * @param presetFilter - ID do preset ou 'all'
 */
async function renderStatsContent(presetFilter: string): Promise<void> {
  const container = document.getElementById('stats-page-content');
  if (!container) return;

  const [records, presets, allSchedules] = await Promise.all([
    getAll<TripRecord>('tripRecords'),
    getAll<Preset>('presets'),
    getAll<Schedule>('schedules')
  ]);

  if (records.length === 0) {
    const statsIconSvg = getIcon('stats', 36, 'empty-state-icon');
    container.innerHTML = `
      <div class="card empty-state" style="padding: 32px 16px;">
        <div class="empty-state-icon" style="color: var(--text-secondary);">${statsIconSvg}</div>
        <div class="empty-state-title" style="margin-top: 12px;">Sem dados suficientes</div>
        <div class="empty-state-desc">
          Você precisa registrar pelo menos uma viagem para que as estatísticas de trânsito e IA sejam calculadas.
        </div>
      </div>
    `;
    return;
  }

  // Filtra registros e horários com base no preset escolhido
  let filteredRecords: TripRecord[] = [];
  let schedules: Schedule[] = [];
  let accuracyText = 'Selecione um trajeto';
  let activePreset: Preset | undefined = undefined;

  if (presetFilter === 'all') {
    filteredRecords = records;
    schedules = allSchedules;
    accuracyText = 'N/A na visão geral';
  } else {
    filteredRecords = records.filter(r => r.presetId === presetFilter);
    activePreset = presets.find(p => p.id === presetFilter);
    
    if (activePreset) {
      // Carrega horários associados a linha do preset selecionado
      schedules = await getSchedulesByLine(activePreset.lineId);
      
      // Calcula precisão do preset
      const accuracy = calculatePredictionAccuracy(filteredRecords, activePreset, schedules);
      accuracyText = accuracy !== null 
        ? `${accuracy.toFixed(0)}%` 
        : 'Sem dados suficientes';
    }
  }

  // Se o filtro específico não retornou registros, exibe estado vazio local
  if (filteredRecords.length === 0) {
    const mapIconSvg = getIcon('mapPin', 36, 'empty-state-icon');
    container.innerHTML = `
      <div class="card empty-state" style="padding: 32px 16px;">
        <div class="empty-state-icon" style="color: var(--text-secondary);">${mapIconSvg}</div>
        <div class="empty-state-title" style="margin-top: 12px;">Sem registros para este trajeto</div>
        <div class="empty-state-desc">
          Nenhuma viagem correspondente a este trajeto foi registrada no histórico ainda.
        </div>
      </div>
    `;
    return;
  }

  // Executa os cálculos estatísticos com a API nativa
  const stats = calculateOverallStats(filteredRecords, schedules);

  // Traduz a tendência para exibição visual
  let trendIconSvg = '';
  let trendLabel = 'Estável';
  switch (stats.recentTrend) {
    case 'improving':
      // Seta apontando para baixo (atrasos diminuindo)
      trendIconSvg = getIcon('arrowRight', 28, 'text-success');
      trendLabel = 'Melhorando (Atrasos menores)';
      break;
    case 'worsening':
      // Seta apontando para cima (atrasos aumentando)
      trendIconSvg = getIcon('arrowRight', 28, 'text-danger');
      trendLabel = 'Piorando (Atrasos maiores)';
      break;
    case 'stable':
      trendIconSvg = getIcon('arrowRight', 28);
      trendLabel = 'Estável';
      break;
    case 'insufficient_data':
    default:
      trendIconSvg = getIcon('alert', 28);
      trendLabel = 'Dados insuficientes';
      break;
  }

  // Estilização extra para rotacionar as setas de tendência
  let trendRotationStyle = '';
  if (stats.recentTrend === 'improving') {
    trendRotationStyle = 'style="transform: rotate(45deg); color: var(--success); transition: transform 0.3s;"'; // aponta para sudeste/baixo
  } else if (stats.recentTrend === 'worsening') {
    trendRotationStyle = 'style="transform: rotate(-45deg); color: var(--danger); transition: transform 0.3s;"'; // aponta para nordeste/cima
  } else if (stats.recentTrend === 'stable') {
    trendRotationStyle = 'style="color: var(--text-secondary);"';
  }

  // Formata o atraso médio
  const avgDelayText = stats.avgDelay > 0 
    ? `+${stats.avgDelay.toFixed(1)} min` 
    : stats.avgDelay < 0 
      ? `${stats.avgDelay.toFixed(1)} min` 
      : 'No horário';

  // Formata o tempo médio de viagem
  const avgDurationText = stats.avgTripDuration !== null
    ? formatMinutes(Math.round(stats.avgTripDuration))
    : 'N/A';

  // Ordena os dias da semana de segunda a domingo para exibição no gráfico
  const orderedDays = [...stats.delayByDay].sort((a, b) => {
    const orderA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
    const orderB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
    return orderA - orderB;
  });

  // Determina o maior atraso médio para definir a proporção das barras do gráfico (mínimo de 1)
  const maxDelay = Math.max(...orderedDays.map(d => Math.abs(d.avgDelay)), 1);

  // ─── RENDERIZAÇÃO DO GRÁFICO SVG DINÂMICO ──────────────────────────────────
  const svgWidth = 400;
  const svgHeight = 220;
  const paddingLeft = 32;
  const paddingRight = 12;
  const paddingTop = 24;
  const paddingBottom = 32;
  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  // Linhas de grade horizontais e rótulos do eixo Y
  const gridTicks = [0, maxDelay * 0.33, maxDelay * 0.66, maxDelay];
  const gridLinesHtml = gridTicks.map(tick => {
    const y = svgHeight - paddingBottom - (tick / maxDelay) * chartHeight;
    return `
      <line x1="${paddingLeft}" y1="${y}" x2="${svgWidth - paddingRight}" y2="${y}" class="grid-line" />
      <text x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end" class="chart-text">${Math.round(tick)}m</text>
    `;
  }).join('');

  // Desenha as barras e rótulos do eixo X
  const barSpacing = chartWidth / 7;
  const barWidth = 24;

  const svgElementsHtml = orderedDays.map((day, index) => {
    const delayVal = day.avgDelay;
    const isHasData = day.recordCount > 0;
    
    // Altura proporcional
    const height = isHasData ? (Math.abs(delayVal) / maxDelay) * chartHeight : 4; 
    const x = paddingLeft + index * barSpacing + (barSpacing - barWidth) / 2;
    const y = svgHeight - paddingBottom - height;

    let barColor = 'var(--border)'; // Sem dados (cinza)
    if (isHasData) {
      if (delayVal > 10) barColor = 'var(--danger)'; // Vermelho para atrasos pesados
      else if (delayVal > 5) barColor = 'var(--warning)'; // Amarelo para atrasos leves
      else barColor = 'var(--success)'; // Verde para pontual
    }

    const shortDayName = day.dayName.substring(0, 3);
    const tooltipText = isHasData ? `${delayVal > 0 ? '+' : ''}${delayVal.toFixed(1)}m (${day.recordCount} v.)` : 'Sem dados';

    return `
      <g class="bar-group">
        <title>${day.dayName}: ${tooltipText}</title>
        <!-- Barra retangular em SVG -->
        <rect 
          x="${x}" 
          y="${y}" 
          width="${barWidth}" 
          height="${height}" 
          fill="${barColor}" 
          rx="4" 
          ry="4" 
          class="bar"
        />
        <!-- Texto de valor no topo da barra (exibido em hover no css) -->
        <text 
          x="${x + barWidth / 2}" 
          y="${y - 6}" 
          class="bar-val-text"
        >
          ${isHasData ? `${delayVal > 0 ? '+' : ''}${delayVal.toFixed(0)}m` : ''}
        </text>
        <!-- Rótulo do Dia no Eixo X -->
        <text 
          x="${x + barWidth / 2}" 
          y="${svgHeight - 12}" 
          class="bar-label chart-text"
        >
          ${shortDayName}
        </text>
      </g>
    `;
  }).join('');

  const svgChartHtml = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="svg-chart">
      <!-- Linhas de grade horizontais -->
      ${gridLinesHtml}
      
      <!-- Linha do Eixo X -->
      <line x1="${paddingLeft}" y1="${svgHeight - paddingBottom}" x2="${svgWidth - paddingRight}" y2="${svgHeight - paddingBottom}" class="axis-line" />
      
      <!-- Elementos das barras e rótulos X -->
      ${svgElementsHtml}
    </svg>
  `;

  // Rótulos de ícones para as estatísticas
  const clockIconSvg = getIcon('clock', 18);
  const checkIconSvg = getIcon('check', 18);
  const alertIconSvg = getIcon('alert', 18);

  container.innerHTML = `
    <!-- Cards de Métricas Principais -->
    <div class="stats-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
      <div class="stat-card" style="padding: 12px 14px;">
        <span class="stat-label">Total Viagens</span>
        <span class="stat-value">${stats.totalRecords}</span>
        <span class="stat-meta">gravadas no local</span>
      </div>

      <div class="stat-card" style="padding: 12px 14px;">
        <span class="stat-label">Atraso Médio</span>
        <span class="stat-value ${stats.avgDelay > 5 ? 'red' : 'green'}">${avgDelayText}</span>
        <span class="stat-meta">em relação à tabela</span>
      </div>

      <div class="stat-card" style="padding: 12px 14px;">
        <span class="stat-label">Média Viagem</span>
        <span class="stat-value">${avgDurationText}</span>
        <span class="stat-meta">tempo no ônibus</span>
      </div>

      <div class="stat-card" style="padding: 12px 14px;">
        <span class="stat-label">Precisão IA</span>
        <span class="stat-value" style="color: var(--accent);">${accuracyText}</span>
        <span class="stat-meta">margem de até 3min</span>
      </div>
    </div>

    <!-- Card de Tendência Recente -->
    <div class="card" style="margin-bottom: 16px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
      <div>
        <span class="label" style="margin-bottom: 2px; font-size: 10px;">Tendência de Atraso</span>
        <span style="font-size: 14px; font-weight: 700; color: var(--text);">${trendLabel}</span>
      </div>
      <span ${trendRotationStyle} style="display: flex;">${trendIconSvg}</span>
    </div>

    <!-- Gráfico de Atrasos Semanais -->
    <div class="card" style="margin-bottom: 16px;">
      <h3 style="margin-bottom: 2px;">Atraso Médio por Dia</h3>
      <p style="font-size: 11px; margin-bottom: 8px;">Valores de atraso em minutos comparados com o horário da tabela.</p>
      
      <div class="chart-container" style="position: relative;">
        ${svgChartHtml}
      </div>
    </div>

    <!-- Informações Extras (Mais Pontual vs Mais Atrasado) -->
    <div class="card" style="background-color: var(--surface); padding: 12px 16px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
        <span style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
          ${checkIconSvg} Dia Mais Pontual:
        </span>
        <strong style="font-size: 13px; color: var(--success);">${stats.mostPunctualDay || 'Sem dados'}</strong>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 2px;">
        <span style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
          ${alertIconSvg} Dia Mais Atrasado:
        </span>
        <strong style="font-size: 13px; color: var(--danger);">${stats.mostDelayedDay || 'Sem dados'}</strong>
      </div>
    </div>
  `;
}
