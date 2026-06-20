// ============================================================
// stats.ts — Painel de Estatísticas e Métricas do BusTracker
// ============================================================

import { getAll, getSettings, getSchedulesByLine } from '../db/database';
import { TripRecord, Preset, Schedule } from '../types';
import { calculateOverallStats, calculatePredictionAccuracy } from '../services/statistics';
import { formatMinutes } from '../utils/time';

/**
 * Renderiza o esqueleto HTML do painel de estatísticas.
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
        <option value="all">Visão Geral (Todos)</option>
      </select>
    </div>

    <!-- Container dos Dashboards -->
    <div id="stats-dashboard-content">
      <p style="text-align: center; padding: 24px 0;">Carregando estatísticas...</p>
    </div>
  `;
}

/**
 * Inicializa a página populando os filtros e calculando estatísticas na tela.
 */
export async function initStatsPage(): Promise<void> {
  const filterSelect = document.getElementById('stats-preset-filter') as HTMLSelectElement;
  if (!filterSelect) return;

  // Carrega presets e configurações do usuário
  const [presets, settings] = await Promise.all([
    getAll<Preset>('presets'),
    getSettings()
  ]);

  // Popula o dropdown de trajetos
  filterSelect.innerHTML = '<option value="all">Visão Geral (Todos)</option>';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.icon} ${p.name}`;
    if (settings.activePresetId === p.id) {
      opt.selected = true;
    }
    filterSelect.appendChild(opt);
  });

  // Atualiza as estatísticas com o preset inicial (se configurado) ou visão geral
  const initialFilter = filterSelect.value || 'all';
  await updateStatsView(initialFilter);

  // Recalcula ao mudar a seleção
  filterSelect.addEventListener('change', async () => {
    await updateStatsView(filterSelect.value);
  });
}

/**
 * Processa estatísticas com a API de analytics e injeta no DOM.
 * 
 * @param presetFilter - ID do preset ou 'all'
 */
async function updateStatsView(presetFilter: string): Promise<void> {
  const container = document.getElementById('stats-dashboard-content');
  if (!container) return;

  // Carrega os dados necessários do IndexedDB
  const [records, presets, allSchedules] = await Promise.all([
    getAll<TripRecord>('tripRecords'),
    getAll<Preset>('presets'),
    getAll<Schedule>('schedules')
  ]);

  // Se não houver viagens gravadas, mostra estado vazio
  if (records.length === 0) {
    container.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">Sem estatísticas no momento</div>
        <div class="empty-state-desc">
          O painel de estatísticas requer histórico de viagens registradas para apresentar atrasos médios, gráficos e precisões.
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
    accuracyText = 'Visão geral N/A';
  } else {
    filteredRecords = records.filter(r => r.presetId === presetFilter);
    activePreset = presets.find(p => p.id === presetFilter);
    
    if (activePreset) {
      // Carrega horários associados a linha do preset selecionado
      schedules = await getSchedulesByLine(activePreset.lineId);
      
      // Calcula precisão do preset
      const accuracy = calculatePredictionAccuracy(filteredRecords, activePreset, schedules);
      accuracyText = accuracy !== null 
        ? `${(accuracy * 100).toFixed(0)}%` 
        : 'Sem dados suficientes';
    }
  }

  // Se o filtro específico não retornou registros, exibe estado vazio local
  if (filteredRecords.length === 0) {
    container.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-title">Sem registros para este trajeto</div>
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
  let trendIcon = '➡️';
  let trendLabel = 'Estável';
  switch (stats.recentTrend) {
    case 'improving':
      trendIcon = '📉'; // Atrasos estão diminuindo (Melhorando)
      trendLabel = 'Melhorando (Atrasos menores)';
      break;
    case 'worsening':
      trendIcon = '📈'; // Atrasos aumentando (Piorando)
      trendLabel = 'Piorando (Atrasos maiores)';
      break;
    case 'stable':
      trendIcon = '➡️';
      trendLabel = 'Estável';
      break;
    case 'insufficient_data':
    default:
      trendIcon = 'ℹ️';
      trendLabel = 'Dados insuficientes';
      break;
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
    // Mapeia 0 (Domingo) para 7 para empurrar pro fim da lista
    const orderA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
    const orderB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
    return orderA - orderB;
  });

  // Determina o maior atraso médio para definir a proporção das barras do gráfico (mínimo de 1)
  const maxDelay = Math.max(...orderedDays.map(d => Math.abs(d.avgDelay)), 1);

  // Gera o HTML das barras do gráfico
  const barsHtml = orderedDays.map(day => {
    const delayVal = day.avgDelay;
    
    // Calcula a porcentagem de altura proporcional (garantindo altura mínima de 4% para visibilidade)
    const heightPercent = Math.max((Math.abs(delayVal) / maxDelay) * 100, 4);

    // Determina a classe de cor da barra
    let barColorClass = 'green';
    if (day.recordCount === 0) {
      barColorClass = 'none'; // sem registros
    } else if (delayVal > 10) {
      barColorClass = 'red';
    } else if (delayVal > 5) {
      barColorClass = 'yellow';
    }

    const tooltipValue = day.recordCount > 0 
      ? `${delayVal > 0 ? '+' : ''}${delayVal.toFixed(1)}m` 
      : '-';

    const shortDayName = day.dayName.substring(0, 3); // "Segunda" -> "Seg"

    return `
      <div class="chart-bar-wrapper">
        <div class="chart-bar ${barColorClass}" style="height: ${day.recordCount > 0 ? heightPercent : 2}%;">
          ${day.recordCount > 0 ? `<div class="chart-bar-tooltip">${tooltipValue}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Gera os rótulos dos dias da semana correspondentes no eixo X do gráfico
  const labelsHtml = orderedDays.map(day => {
    const shortDayName = day.dayName.substring(0, 3);
    return `<div class="chart-label">${shortDayName}</div>`;
  }).join('');

  container.innerHTML = `
    <!-- Cards de Métricas Principais -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Total Viagens</span>
        <span class="stat-value">${stats.totalRecords}</span>
        <span class="stat-meta">gravadas no local</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Atraso Médio</span>
        <span class="stat-value ${stats.avgDelay > 5 ? 'red' : 'green'}">${avgDelayText}</span>
        <span class="stat-meta">em relação à tabela</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Média Viagem</span>
        <span class="stat-value">${avgDurationText}</span>
        <span class="stat-meta">tempo no ônibus</span>
      </div>

      <div class="stat-card">
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
      <span style="font-size: 32px; line-height: 1;">${trendIcon}</span>
    </div>

    <!-- Gráfico de Atrasos Semanais -->
    <div class="card">
      <h3>Atraso Médio por Dia da Semana</h3>
      <p style="font-size: 12px; margin-bottom: 8px;">Valores médios em minutos comparados com o horário programado.</p>
      
      <div class="chart-container">
        <div class="chart-bars">
          ${barsHtml}
        </div>
        <div class="chart-labels">
          ${labelsHtml}
        </div>
      </div>
    </div>

    <!-- Informações Extras (Mais Pontual vs Mais Atrasado) -->
    <div class="card" style="background-color: var(--surface); padding: 12px 16px;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
        <span style="font-size: 13px; color: var(--text-secondary);">Dia Mais Pontual:</span>
        <strong style="font-size: 13px; color: var(--success);">${stats.mostPunctualDay || 'Sem dados'}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding-top: 2px;">
        <span style="font-size: 13px; color: var(--text-secondary);">Dia Mais Atrasado:</span>
        <strong style="font-size: 13px; color: var(--danger);">${stats.mostDelayedDay || 'Sem dados'}</strong>
      </div>
    </div>
  `;
}
