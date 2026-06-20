// ============================================================
// home.ts — Tela principal do BusTracker (Rastreamento e Previsão)
// ============================================================

import { getSettings, saveSettings, getAll, getById, put, getSchedulesByLine } from '../db/database';
import { Preset, TripRecord, BusLine, BusStop, Schedule } from '../types';
import { findNextBus, minutesUntilArrival } from '../services/prediction';
import { currentTime, currentDate, formatMinutes, timeDiffMinutes } from '../utils/time';
import { generateId, detectDayType } from '../utils/helpers';
import { renderCountdown } from '../components/countdown';
import { renderConfidence } from '../components/confidence';
import { showToast } from '../components/toast';
import { renderThemeToggle, initThemeToggle } from '../components/theme-toggle';
import { setCountdownInterval } from '../main';

// Guarda o ID do registro de viagem em andamento
let activeTripRecord: TripRecord | null = null;

/**
 * Renderiza o HTML esqueleto da página Home.
 * 
 * @returns String contendo o HTML básico
 */
export async function renderHomePage(): Promise<string> {
  const themeToggleHtml = renderThemeToggle();

  return `
    <div class="app-header">
      <div class="app-title">
        <span>🚌 Bus<span class="app-title-accent">Tracker</span></span>
      </div>
      ${themeToggleHtml}
    </div>

    <div class="card" style="margin-bottom: 20px; padding: 12px 16px;">
      <label class="label" for="preset-selector">Trajeto Ativo</label>
      <select class="select" id="preset-selector" style="margin-bottom: 0;">
        <option value="none">Carregando trajetos...</option>
      </select>
    </div>

    <div id="home-tracker-content">
      <!-- O conteúdo do rastreador será injetado dinamicamente -->
    </div>
  `;
}

/**
 * Inicializa a lógica da página Home.
 * Popula o seletor de presets, escuta mudanças e inicia o intervalo do timer.
 */
export async function initHomePage(): Promise<void> {
  // Inicializa o alternador de temas no cabeçalho
  initThemeToggle();

  const presetSelector = document.getElementById('preset-selector') as HTMLSelectElement;
  if (!presetSelector) return;

  // Busca presets e configurações
  const presets = await getAll<Preset>('presets');
  const settings = await getSettings();

  // Limpa o seletor
  presetSelector.innerHTML = '';

  if (presets.length === 0) {
    presetSelector.innerHTML = '<option value="none">Nenhum trajeto salvo</option>';
    renderEmptyState();
    return;
  }

  // Preenche o dropdown de trajetos salvos
  presets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = `${preset.icon} ${preset.name}`;
    if (settings.activePresetId === preset.id) {
      option.selected = true;
    }
    presetSelector.appendChild(option);
  });

  // Se não há preset ativo selecionado nas configurações, seleciona o primeiro
  let activePresetId = settings.activePresetId;
  if (!activePresetId || !presets.some(p => p.id === activePresetId)) {
    activePresetId = presets[0].id;
    await saveSettings({ activePresetId });
    presetSelector.value = activePresetId;
  }

  // Escuta alteração de preset ativo
  presetSelector.addEventListener('change', async () => {
    const selectedId = presetSelector.value;
    await saveSettings({ activePresetId: selectedId });
    
    // Reseta o registro ativo se mudar de preset
    activeTripRecord = null;
    await updateTrackerView(selectedId);
  });

  // Verifica se há alguma viagem ativa em andamento no IndexedDB
  await checkForActiveTrip(activePresetId);

  // Executa a primeira renderização do painel de rastreamento
  await updateTrackerView(activePresetId);

  // Define um intervalo para atualizar o countdown a cada segundo
  const intervalId = window.setInterval(async () => {
    const currentSettings = await getSettings();
    if (currentSettings.activePresetId) {
      await updateTrackerView(currentSettings.activePresetId);
    }
  }, 1000);

  // Compartilha o ID do timer com o router para limpeza na navegação
  setCountdownInterval(intervalId);
}

/**
 * Busca por uma viagem que tenha sido iniciada hoje e não tenha horário de chegada no destino.
 * Isso permite persistir o estado do botão caso o usuário recarregue a página.
 */
async function checkForActiveTrip(presetId: string): Promise<void> {
  const records = await getAll<TripRecord>('tripRecords');
  const today = currentDate();
  
  // Filtra por registros de hoje para o preset ativo sem horário de destino
  const activeRecord = records.find(
    r => r.presetId === presetId && r.date === today && !r.arrivedAtDestination
  );

  if (activeRecord) {
    activeTripRecord = activeRecord;
  } else {
    activeTripRecord = null;
  }
}

/**
 * Renderiza um estado vazio quando não há trajetos/presets configurados.
 */
function renderEmptyState(): void {
  const container = document.getElementById('home-tracker-content');
  if (!container) return;

  container.innerHTML = `
    <div class="card empty-state">
      <div class="empty-state-icon">🗺️</div>
      <div class="empty-state-title">Nenhum trajeto configurado</div>
      <div class="empty-state-desc">
        Crie linhas, pontos e configure um trajeto personalizado na aba "Gerenciar" para ver previsões aqui.
      </div>
      <a href="#manage" class="btn btn-primary">Configurar Trajetos</a>
    </div>
  `;
}

/**
 * Atualiza dinamicamente o painel de rastreamento com previsões do motor de IA.
 * 
 * @param presetId - O ID do preset ativo
 */
async function updateTrackerView(presetId: string): Promise<void> {
  const container = document.getElementById('home-tracker-content');
  if (!container || presetId === 'none') return;

  // Busca os dados do preset e seus detalhes relacionados
  const preset = await getById<Preset>('presets', presetId);
  if (!preset) {
    renderEmptyState();
    return;
  }

  const [line, boardingStop, destinationStop, schedules, records] = await Promise.all([
    getById<BusLine>('busLines', preset.lineId),
    getById<BusStop>('busStops', preset.boardingStopId),
    getById<BusStop>('busStops', preset.destinationStopId),
    getSchedulesByLine(preset.lineId),
    getAll<TripRecord>('tripRecords')
  ]);

  if (!line || !boardingStop || !destinationStop) {
    container.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-title">Dados incompletos</div>
        <div class="empty-state-desc">Algumas informações deste trajeto (linha ou pontos) foram apagadas.</div>
        <a href="#manage" class="btn btn-primary">Ajustar nas Configurações</a>
      </div>
    `;
    return;
  }

  // Filtra registros históricos específicos deste preset para alimentar o algoritmo
  const presetRecords = records.filter(r => r.presetId === preset.id);

  // Detecta o tipo de dia e calcula a previsão do próximo ônibus
  const currentDayType = detectDayType(new Date());
  const prediction = findNextBus(preset, schedules, presetRecords, currentDayType);

  if (!prediction) {
    container.innerHTML = `
      <div class="card">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="font-size: 24px;">${preset.icon}</span>
          <div>
            <h2 style="margin-bottom: 2px;">${preset.name}</h2>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="record-line-badge" style="background-color: ${line.color};">${line.number}</span>
              <span style="font-size: 12px; color: var(--text-secondary);">${line.name}</span>
            </div>
          </div>
        </div>
        <div class="empty-state" style="padding: 24px 0;">
          <div class="empty-state-icon">😴</div>
          <div class="empty-state-title">Sem viagens agendadas</div>
          <div class="empty-state-desc">Não há mais ônibus programados na tabela para o dia de hoje.</div>
        </div>
      </div>
    `;
    return;
  }

  // Calcula os minutos restantes até a chegada prevista
  const minutesLeft = minutesUntilArrival(prediction);

  // Renderiza os componentes de UI
  const countdownHtml = renderCountdown(minutesLeft);
  const confidenceHtml = renderConfidence(prediction.confidence, prediction.recordCount, prediction.reliability);

  // Monta a estrutura da previsão detalhada
  const isTripInProgress = activeTripRecord !== null;

  container.innerHTML = `
    <div class="card" style="margin-bottom: 16px;">
      <!-- Cabeçalho do Preset -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 28px;">${preset.icon}</span>
          <div>
            <h2 style="margin-bottom: 2px; font-size: 16px; font-weight: 700;">${preset.name}</h2>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="record-line-badge" style="background-color: ${line.color};">${line.number}</span>
              <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">${line.name}</span>
            </div>
          </div>
        </div>
        <div style="text-align: right;">
          <span class="label" style="margin-bottom: 2px; font-size: 10px;">Programado</span>
          <span style="font-size: 16px; font-weight: 700; color: var(--text);">${prediction.scheduledDeparture}</span>
        </div>
      </div>

      <!-- Barra de Rotas (Origem -> Destino) -->
      <div style="position: relative; padding-left: 20px; margin-bottom: 16px;">
        <div style="position: absolute; left: 6px; top: 6px; bottom: 6px; width: 2px; background-color: var(--border); display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background-color: var(--accent); margin-left: -3px;"></div>
          <div style="width: 8px; height: 8px; border-radius: 50%; background-color: var(--success); margin-left: -3px;"></div>
        </div>
        <div style="margin-bottom: 12px;">
          <span class="label" style="font-size: 9px; margin-bottom: 2px;">Embarque</span>
          <span style="font-size: 13px; font-weight: 600; color: var(--text);">${boardingStop.name}</span>
        </div>
        <div>
          <span class="label" style="font-size: 9px; margin-bottom: 2px;">Desembarque</span>
          <span style="font-size: 13px; font-weight: 600; color: var(--text);">${destinationStop.name}</span>
        </div>
      </div>

      <!-- Componente do Contador -->
      ${countdownHtml}

      <!-- Horários previstos -->
      <div class="card" style="background-color: var(--bg); margin: 16px 0 12px 0; padding: 12px; border-radius: var(--radius);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; color: var(--text-secondary);">Previsão no Ponto:</span>
          <span style="font-size: 13px; font-weight: 700; color: var(--text);">~${prediction.predictedBusArrival}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="font-size: 13px; color: var(--text-secondary);">Previsão no Destino:</span>
          <span style="font-size: 13px; font-weight: 700; color: var(--success);">
            ${prediction.predictedDestinationArrival ? `~${prediction.predictedDestinationArrival}` : 'Sem histórico'}
          </span>
        </div>
      </div>

      <!-- Barra de Confiança -->
      ${confidenceHtml}
    </div>

    <!-- Botões de Registro -->
    <div style="margin-top: 16px;">
      ${isTripInProgress 
        ? `<button class="btn btn-success btn-lg" id="btn-arrive-destination" style="box-shadow: 0 4px 12px rgba(34, 197, 94, 0.25);">📍 Cheguei no Destino!</button>`
        : `<button class="btn btn-primary btn-lg" id="btn-bus-arrived" style="box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);">🚌 Ônibus Chegou!</button>`
      }
    </div>
  `;

  // Anexa listeners de eventos aos botões recém-gerados
  const btnBusArrived = document.getElementById('btn-bus-arrived');
  const btnArriveDestination = document.getElementById('btn-arrive-destination');

  if (btnBusArrived) {
    btnBusArrived.addEventListener('click', async () => {
      // Registra a chegada do ônibus no ponto
      const nowStr = currentTime();
      const currentDayType = detectDayType(new Date());

      // Busca tabelas de horários do dia
      const daySchedules = await getSchedulesByLine(preset.lineId, currentDayType);

      if (daySchedules.length === 0) {
        showToast('Nenhum horário cadastrado nesta linha para hoje.', 'error');
        return;
      }

      // Encontra a partida programada mais próxima do horário real de agora
      let closestSchedule = daySchedules[0];
      let minDiff = Math.abs(timeDiffMinutes(closestSchedule.departureTime, nowStr));

      for (const schedule of daySchedules) {
        const diff = Math.abs(timeDiffMinutes(schedule.departureTime, nowStr));
        if (diff < minDiff) {
          minDiff = diff;
          closestSchedule = schedule;
        }
      }

      // Cria o registro da viagem
      const record: TripRecord = {
        id: generateId(),
        presetId: preset.id,
        date: currentDate(),
        dayOfWeek: new Date().getDay(),
        dayType: currentDayType,
        scheduledDeparture: closestSchedule.departureTime,
        busArrivedAt: nowStr
      };

      // Salva e atualiza o estado
      await put('tripRecords', record);
      activeTripRecord = record;

      showToast('Embarque registrado! Boa viagem.', 'success');
      await updateTrackerView(presetId);
    });
  }

  if (btnArriveDestination) {
    btnArriveDestination.addEventListener('click', async () => {
      if (!activeTripRecord) return;

      // Adiciona o horário de chegada no destino e atualiza IndexedDB
      activeTripRecord.arrivedAtDestination = currentTime();
      await put('tripRecords', activeTripRecord);

      showToast('Viagem concluída! Destino registrado.', 'success');
      activeTripRecord = null; // Libera a viagem em andamento
      
      await updateTrackerView(presetId);
    });
  }
}
