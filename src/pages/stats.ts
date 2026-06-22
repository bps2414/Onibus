// ============================================================
// stats.ts — Página de Estatísticas e Análise de Desempenho v2
// ============================================================

import { getAll, getSchedulesByLine, getSettings } from '../db/database';
import { TripRecord, Preset, Schedule, BusLine } from '../types';
import { calculateOverallStats, calculatePredictionAccuracy, calculatePresetBaselines, getRecordDelay } from '../services/statistics';
import { formatMinutes, timeToMinutes, timeDiffMinutes } from '../utils/time';
import { getIcon } from '../components/icons';
import { getTimeBand } from '../services/prediction-utils';

/**
 * Renderiza o esqueleto HTML da página de estatísticas com filtro de trajeto.
 * 
 * @returns String contendo o HTML básico com estilo customizado para gráficos
 */
export async function renderStatsPage(): Promise<string> {
  return `
    <style>
      .svg-chart {
        overflow: visible;
        width: 100%;
        height: auto;
      }
      .grid-line {
        stroke: var(--border);
        opacity: 0.15;
        stroke-width: 1;
      }
      .axis-line {
        stroke: var(--border);
        stroke-width: 1.5;
      }
      .chart-text {
        font-size: 9px;
        fill: var(--text-secondary);
        font-family: inherit;
      }
      .bar {
        transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1), y 0.4s cubic-bezier(0.4, 0, 0.2, 1), fill 0.2s ease;
      }
      .bar:hover {
        fill: var(--accent) !important;
        cursor: pointer;
      }
      .bar-val-text {
        font-size: 8px;
        fill: var(--text);
        text-anchor: middle;
        font-weight: 600;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .bar-group:hover .bar-val-text {
        opacity: 1;
      }
      .scatter-dot {
        transition: r 0.2s ease, opacity 0.2s ease;
      }
      .scatter-dot:hover {
        r: 6.5;
        opacity: 1 !important;
        cursor: pointer;
      }
      .line-point {
        transition: r 0.2s ease;
      }
      .line-point:hover {
        r: 6;
        cursor: pointer;
      }
      .donut-segment {
        transition: stroke-width 0.2s ease;
      }
      .donut-segment:hover {
        stroke-width: 14;
        cursor: pointer;
      }
    </style>

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

  const baselines = calculatePresetBaselines(records);

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
    accuracyText = 'N/A';
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
      trendIconSvg = getIcon('arrowRight', 28);
      trendLabel = 'Melhorando (Atrasos menores)';
      break;
    case 'worsening':
      trendIconSvg = getIcon('arrowRight', 28);
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
      : '0 min';

  // Formata o tempo médio de viagem
  const avgDurationText = stats.avgTripDuration !== null
    ? formatMinutes(Math.round(stats.avgTripDuration))
    : 'N/A';

  // ============================================================
  // GRÁFICO 1: ATRASO MÉDIO POR DIA DA SEMANA (Barras SVG Animadas)
  // ============================================================
  const orderedDays = [...stats.delayByDay].sort((a, b) => {
    const orderA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
    const orderB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
    return orderA - orderB;
  });

  const maxDelay = Math.max(...orderedDays.map(d => Math.abs(d.avgDelay)), 1);

  const barChartWidth = 400;
  const barChartHeight = 180;
  const paddingL = 32;
  const paddingR = 12;
  const paddingT = 24;
  const paddingB = 28;
  const graphW = barChartWidth - paddingL - paddingR;
  const graphH = barChartHeight - paddingT - paddingB;

  // Linhas de grade do eixo Y
  const gridTicks = [0, maxDelay * 0.5, maxDelay];
  const barGridHtml = gridTicks.map(tick => {
    const y = barChartHeight - paddingB - (tick / maxDelay) * graphH;
    return `
      <line x1="${paddingL}" y1="${y}" x2="${barChartWidth - paddingR}" y2="${y}" class="grid-line" />
      <text x="${paddingL - 6}" y="${y + 3}" text-anchor="end" class="chart-text">${Math.round(tick)}m</text>
    `;
  }).join('');

  const barSpacing = graphW / 7;
  const barWidth = 22;

  const barElementsHtml = orderedDays.map((day, index) => {
    const delayVal = day.avgDelay;
    const isHasData = day.recordCount > 0;
    const height = isHasData ? (Math.abs(delayVal) / maxDelay) * graphH : 3; 
    const x = paddingL + index * barSpacing + (barSpacing - barWidth) / 2;
    const y = barChartHeight - paddingB - height;

    let barColor = 'var(--border)';
    if (isHasData) {
      if (delayVal > 8) barColor = 'var(--danger)';
      else if (delayVal > 4) barColor = 'var(--warning)';
      else barColor = 'var(--success)';
    }

    const shortDayName = day.dayName.substring(0, 3);
    const tooltip = isHasData ? `${day.dayName}: +${delayVal.toFixed(1)}m (${day.recordCount} viagens)` : `${day.dayName}: Sem registros`;

    return `
      <g class="bar-group">
        <title>${tooltip}</title>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="${barColor}" rx="4" class="bar" />
        <text x="${x + barWidth / 2}" y="${y - 6}" class="bar-val-text">${isHasData ? `+${delayVal.toFixed(0)}m` : ''}</text>
        <text x="${x + barWidth / 2}" y="${barChartHeight - 10}" class="chart-text" text-anchor="middle">${shortDayName}</text>
      </g>
    `;
  }).join('');

  // ============================================================
  // GRÁFICO 2: LINHA TEMPORAL DE TENDÊNCIA (Últimas 30 Viagens)
  // ============================================================
  const sortedRecords = [...filteredRecords]
    .sort((a, b) => a.date.localeCompare(b.date) || a.scheduledDeparture.localeCompare(b.scheduledDeparture))
    .slice(-30);

  let timelineHtml = '';
  if (sortedRecords.length >= 3) {
    const timeChartWidth = 400;
    const timeChartHeight = 160;
    const tlPaddingL = 32;
    const tlPaddingR = 12;
    const tlPaddingT = 20;
    const tlPaddingB = 24;
    const tlW = timeChartWidth - tlPaddingL - tlPaddingR;
    const tlH = timeChartHeight - tlPaddingT - tlPaddingB;

    const tripDelays = sortedRecords.map(r => getRecordDelay(r, baselines));
    let maxTlDelay = Math.max(...tripDelays, 5);
    let minTlDelay = Math.min(...tripDelays, -5);
    if (minTlDelay > 0) minTlDelay = 0;
    
    const rangeTl = maxTlDelay - minTlDelay || 1;

    const getTlY = (d: number) => tlPaddingT + ((maxTlDelay - d) / rangeTl) * tlH;
    const getTlX = (idx: number) => tlPaddingL + (idx * tlW) / (sortedRecords.length - 1);

    const tlGridTicks = Array.from(new Set([minTlDelay, 0, maxTlDelay])).sort((a, b) => a - b);
    const tlGridHtml = tlGridTicks.map(tick => {
      const y = getTlY(tick);
      return `
        <line x1="${tlPaddingL}" y1="${y}" x2="${timeChartWidth - tlPaddingR}" y2="${y}" class="grid-line" />
        <text x="${tlPaddingL - 6}" y="${y + 3}" text-anchor="end" class="chart-text">${Math.round(tick)}m</text>
      `;
    }).join('');

    let pathD = '';
    const pointsHtml = sortedRecords.map((r, idx) => {
      const delay = getRecordDelay(r, baselines);
      const x = getTlX(idx);
      const y = getTlY(delay);

      if (idx === 0) pathD = `M ${x} ${y}`;
      else pathD += ` L ${x} ${y}`;

      const formattedDate = formatDate(r.date);
      const tooltip = `Viagem ${idx + 1} (${formattedDate} ${r.scheduledDeparture}): ${delay > 0 ? '+' : ''}${delay} min`;

      return `
        <circle cx="${x}" cy="${y}" r="3.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5" class="line-point">
          <title>${tooltip}</title>
        </circle>
      `;
    }).join('');

    timelineHtml = `
      <div class="card" style="margin-bottom: 16px;">
        <h3 style="margin-bottom: 2px; font-size: 15px; font-weight: 600;">Evolução dos Atrasos</h3>
        <p style="font-size: 11px; margin-bottom: 12px; color: var(--text-secondary);">Histórico cronológico das últimas ${sortedRecords.length} viagens registradas.</p>
        <div class="chart-container">
          <svg viewBox="0 0 ${timeChartWidth} ${timeChartHeight}" class="svg-chart">
            ${tlGridHtml}
            <line x1="${tlPaddingL}" y1="${timeChartHeight - tlPaddingB}" x2="${timeChartWidth - tlPaddingR}" y2="${timeChartHeight - tlPaddingB}" class="axis-line" />
            <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.6" />
            ${pointsHtml}
            <text x="${tlPaddingL}" y="${timeChartHeight - 4}" class="chart-text" text-anchor="start">Antigo</text>
            <text x="${timeChartWidth - tlPaddingR}" y="${timeChartHeight - 4}" class="chart-text" text-anchor="end">Recente</text>
          </svg>
        </div>
      </div>
    `;
  }

  // ============================================================
  // GRÁFICO 3: DISTRIBUIÇÃO POR FAIXA HORÁRIA (Donut SVG)
  // ============================================================
  const bandCounts = { dawn: 0, morning_rush: 0, midday: 0, evening_rush: 0, night: 0 };
  filteredRecords.forEach(r => {
    const band = getTimeBand(r.scheduledDeparture);
    if (band in bandCounts) {
      bandCounts[band as keyof typeof bandCounts]++;
    }
  });

  const totalBandRecords = Object.values(bandCounts).reduce((a, b) => a + b, 0);

  const bandMetadata = [
    { key: 'dawn', label: 'Madrugada', color: '#a78bfa' },
    { key: 'morning_rush', label: 'Rush Manhã', color: '#f87171' },
    { key: 'midday', label: 'Entrepico', color: '#fbbf24' },
    { key: 'evening_rush', label: 'Rush Tarde', color: '#f472b6' },
    { key: 'night', label: 'Noite', color: '#60a5fa' }
  ];

  let donutSegmentsHtml = '';
  let accumulatedOffset = 0;
  const radius = 45;
  const circumference = 2 * Math.PI * radius; // 282.74

  bandMetadata.forEach(meta => {
    const count = bandCounts[meta.key as keyof typeof bandCounts];
    if (count > 0 && totalBandRecords > 0) {
      const percentage = count / totalBandRecords;
      const segmentLength = percentage * circumference;
      donutSegmentsHtml += `
        <circle 
          cx="65" 
          cy="65" 
          r="${radius}" 
          stroke="${meta.color}" 
          stroke-width="10" 
          fill="transparent" 
          stroke-dasharray="${segmentLength} ${circumference}" 
          stroke-dashoffset="${accumulatedOffset}" 
          transform="rotate(-90, 65, 65)"
          class="donut-segment"
        >
          <title>${meta.label}: ${count} viagens (${(percentage * 100).toFixed(0)}%)</title>
        </circle>
      `;
      accumulatedOffset -= segmentLength;
    }
  });

  let donutLegendHtml = bandMetadata.map(meta => {
    const count = bandCounts[meta.key as keyof typeof bandCounts];
    const pct = totalBandRecords > 0 ? (count / totalBandRecords) * 100 : 0;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 10px; height: 10px; border-radius: 50%; background-color: ${meta.color}; display: inline-block;"></span>
          <span style="color: var(--text-secondary);">${meta.label}</span>
        </div>
        <span style="font-weight: 600;">${count} <span style="font-size: 10px; font-weight: normal; color: var(--text-secondary);">(${pct.toFixed(0)}%)</span></span>
      </div>
    `;
  }).join('');

  const donutChartHtml = `
    <div class="card" style="margin-bottom: 16px;">
      <h3 style="margin-bottom: 2px; font-size: 15px; font-weight: 600;">Viagens por Faixa Horária</h3>
      <p style="font-size: 11px; margin-bottom: 16px; color: var(--text-secondary);">Frequência de registros de viagens por período do dia.</p>
      
      <div style="display: flex; align-items: center; gap: 24px; justify-content: center; flex-wrap: wrap;">
        <div style="width: 130px; height: 130px; position: relative;">
          <svg viewBox="0 0 130 130" style="width: 100%; height: auto;">
            <!-- Fundo cinza suave -->
            <circle cx="65" cy="65" r="${radius}" stroke="var(--border)" stroke-width="10" fill="transparent" opacity="0.1" />
            <!-- Segmentos coloridos -->
            ${donutSegmentsHtml}
          </svg>
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;">
            <span style="font-size: 18px; font-weight: 700;">${totalBandRecords}</span>
            <span class="label" style="font-size: 8px; margin: 0;">Total</span>
          </div>
        </div>
        
        <div style="flex: 1; min-width: 140px;">
          ${donutLegendHtml}
        </div>
      </div>
    </div>
  `;

  // ============================================================
  // GRÁFICO 4: HORA DO DIA VS ATRASO (Scatter Plot - Dispersão)
  // ============================================================
  const scatterWidth = 400;
  const scatterHeight = 160;
  const scPaddingL = 32;
  const scPaddingR = 16;
  const scPaddingT = 20;
  const scPaddingB = 24;
  const scW = scatterWidth - scPaddingL - scPaddingR;
  const scH = scatterHeight - scPaddingT - scPaddingB;

  const scatterDelays = filteredRecords.map(r => getRecordDelay(r, baselines));
  let maxScatterDelay = Math.max(...scatterDelays, 10);
  let minScatterDelay = Math.min(...scatterDelays, -5);
  if (minScatterDelay > 0) minScatterDelay = 0;
  
  const rangeSc = maxScatterDelay - minScatterDelay || 1;
  
  const getScY = (d: number) => scPaddingT + ((maxScatterDelay - d) / rangeSc) * scH;
  const getScX = (timeStr: string) => {
    const mins = timeToMinutes(timeStr);
    return scPaddingL + (mins / 1440) * scW; // 1440 min = 24h
  };

  const scGridTicksY = Array.from(new Set([minScatterDelay, 0, maxScatterDelay])).sort((a, b) => a - b);
  const scGridHtmlY = scGridTicksY.map(tick => {
    const y = getScY(tick);
    return `
      <line x1="${scPaddingL}" y1="${y}" x2="${scatterWidth - scPaddingR}" y2="${y}" class="grid-line" />
      <text x="${scPaddingL - 6}" y="${y + 3}" text-anchor="end" class="chart-text">${Math.round(tick)}m</text>
    `;
  }).join('');

  // Grades verticais a cada 4 horas (04:00, 08:00, 12:00, 16:00, 20:00, 24:00)
  const hoursGrid = [240, 480, 720, 960, 1200, 1440];
  const scGridHtmlX = hoursGrid.map(min => {
    const x = scPaddingL + (min / 1440) * scW;
    const hourLabel = `${String(min / 60).padStart(2, '0')}:00`;
    return `
      <line x1="${x}" y1="${scPaddingT}" x2="${x}" y2="${scatterHeight - scPaddingB}" stroke="var(--border)" opacity="0.08" stroke-width="0.8" />
      <text x="${x}" y="${scatterHeight - 8}" text-anchor="middle" class="chart-text" style="font-size: 8px;">${hourLabel}</text>
    `;
  }).join('');

  const scatterDotsHtml = filteredRecords.map(r => {
    const delay = getRecordDelay(r, baselines);
    const x = getScX(r.scheduledDeparture);
    const y = getScY(delay); // Agora plota atrasos negativos também
    
    let color = 'var(--success)';
    if (delay > 8) color = 'var(--danger)';
    else if (delay > 4) color = 'var(--warning)';

    const tooltip = `Dia ${formatDate(r.date)} (${r.scheduledDeparture}): ${delay >= 0 ? '+' : ''}${delay} min`;
    return `
      <circle cx="${x}" cy="${y}" r="4" fill="${color}" opacity="0.7" class="scatter-dot">
        <title>${tooltip}</title>
      </circle>
    `;
  }).join('');

  const scatterPlotHtml = `
    <div class="card" style="margin-bottom: 16px;">
      <h3 style="margin-bottom: 2px; font-size: 15px; font-weight: 600;">Atraso vs Horário da Viagem</h3>
      <p style="font-size: 11px; margin-bottom: 12px; color: var(--text-secondary);">Dispersão das viagens ao longo do dia para identificar horários de engarrafamento.</p>
      <div class="chart-container">
        <svg viewBox="0 0 ${scatterWidth} ${scatterHeight}" class="svg-chart">
          ${scGridHtmlY}
          ${scGridHtmlX}
          <line x1="${scPaddingL}" y1="${scatterHeight - scPaddingB}" x2="${scatterWidth - scPaddingR}" y2="${scatterHeight - scPaddingB}" class="axis-line" />
          <line x1="${scPaddingL}" y1="${scPaddingT}" x2="${scPaddingL}" y2="${scatterHeight - scPaddingB}" class="axis-line" />
          ${scatterDotsHtml}
        </svg>
      </div>
    </div>
  `;

  // Rótulos de ícones para as estatísticas
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
        <span class="stat-value" style="color: var(--text-secondary);">${accuracyText}</span>
        <span class="stat-meta">${presetFilter === 'all' ? 'selecione um trajeto' : 'margem de até 3min'}</span>
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

    <!-- Gráfico 1: Atrasos Semanais -->
    <div class="card" style="margin-bottom: 16px;">
      <h3 style="margin-bottom: 2px; font-size: 15px; font-weight: 600;">Atraso Médio por Dia</h3>
      <p style="font-size: 11px; margin-bottom: 8px; color: var(--text-secondary);">Valores de atraso em minutos comparados com o horário da tabela.</p>
      
      <div class="chart-container" style="position: relative;">
        <svg viewBox="0 0 ${barChartWidth} ${barChartHeight}" class="svg-chart">
          ${barGridHtml}
          <line x1="${paddingL}" y1="${barChartHeight - paddingB}" x2="${barChartWidth - paddingR}" y2="${barChartHeight - paddingB}" class="axis-line" />
          ${barElementsHtml}
        </svg>
      </div>
    </div>

    <!-- Gráfico 2: Linha Temporal (Tendência Histórica) -->
    ${timelineHtml}

    <!-- Gráfico 3: Donut Faixas Horárias -->
    ${donutChartHtml}

    <!-- Gráfico 4: Scatter Plot (Dispersão Dia/Atraso) -->
    ${scatterPlotHtml}

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

/**
 * Helper interno para formatar datas YYYY-MM-DD para DD/MM
 */
function formatDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`;
  }
  return dateStr;
}
