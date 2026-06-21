// ============================================================
// home.ts — Tela principal do BusTracker (Rastreamento e Previsão)
// ============================================================

import { getSettings, saveSettings, getAll, getById, put, getSchedulesByLine } from '../db/database';
import { Preset, TripRecord, BusLine, BusStop, Schedule } from '../types';
import { findNextBuses, minutesUntilArrival } from '../services/prediction';
import { currentTime, currentDate, formatMinutes, timeDiffMinutes, addMinutes } from '../utils/time';
import { generateId, detectDayType } from '../utils/helpers';
import { renderCountdown } from '../components/countdown';
import { renderConfidence } from '../components/confidence';
import { renderConfidenceInterval, renderTrendBadge, renderOutlierBadge } from '../components/confidence-interval';
import { showToast } from '../components/toast';
import { renderThemeToggle, initThemeToggle } from '../components/theme-toggle';
import { setCountdownInterval } from '../main';
import { getIcon } from '../components/icons';

// Guarda o ID do registro de viagem em andamento
let activeTripRecord: TripRecord | null = null;

// Objeto na memória para evitar múltiplos disparos de notificação para a mesma viagem no mesmo dia
const notifiedTrips: Record<string, boolean> = {};

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
        <span>${getIcon('bus', 24, 'app-title-icon')} Bus<span class="app-title-accent">Tracker</span></span>
      </div>
      ${themeToggleHtml}
    </div>

    <div class="card" style="margin-bottom: 20px; padding: 12px 16px;">
      <label class="label" for="preset-selector">Trajeto Ativo</label>
      <div style="display: flex; gap: 8px; align-items: center;">
        <select class="select" id="preset-selector" style="margin-bottom: 0; flex: 1;">
          <option value="none">Carregando trajetos...</option>
        </select>
        <button id="btn-notify-toggle" class="btn-icon" title="Ativar Alertas de Chegada">
          ${getIcon('bellOff', 20)}
        </button>
      </div>
    </div>

    <div id="home-tracker-content">
      <!-- O conteúdo do rastreador será injetado dinamicamente -->
    </div>
  `;
}

/**
 * Inicializa a lógica da página Home.
 * Popula o seletor de presets, escuta mudanças, registra as notificações e inicia o intervalo do timer.
 */
export async function initHomePage(): Promise<void> {
  // Inicializa o alternador de temas no cabeçalho
  initThemeToggle();

  const presetSelector = document.getElementById('preset-selector') as HTMLSelectElement;
  const btnNotifyToggle = document.getElementById('btn-notify-toggle') as HTMLButtonElement;
  if (!presetSelector || !btnNotifyToggle) return;

  // Busca presets e configurações
  const presets = await getAll<Preset>('presets');
  const settings = await getSettings();

  // Limpa o seletor
  presetSelector.innerHTML = '';

  if (presets.length === 0) {
    presetSelector.innerHTML = '<option value="none">Nenhum trajeto salvo</option>';
    btnNotifyToggle.style.display = 'none';
    renderEmptyState();
    return;
  }

  btnNotifyToggle.style.display = 'flex';

  // Preenche o dropdown de trajetos salvos
  presets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    // O helper getIcon lida com emojis antigos se houver no banco
    option.textContent = preset.name;
    if (settings.activePresetId === preset.id) {
      option.selected = true;
    }
    presetSelector.appendChild(option);
  });

  // Se não há preset ativo selecionado nas configurações, seleciona o primeiro
  let activePresetId = settings.activePresetId;
  if (!activePresetId || !presets.some(p => p.id === activePresetId)) {
    activePresetId = presets[0].id;
    await saveSettings({ activePresetId: activePresetId });
    presetSelector.value = activePresetId;
  }

  // Atualiza o estado visual do botão de notificações inicial
  updateNotifyButtonState(activePresetId);

  // Escuta alteração de preset ativo
  presetSelector.addEventListener('change', async () => {
    const selectedId = presetSelector.value;
    await saveSettings({ activePresetId: selectedId });
    
    // Reseta o registro ativo e atualiza visual do sino
    activeTripRecord = null;
    updateNotifyButtonState(selectedId);
    await updateTrackerView(selectedId);
  });

  // Event listener para ativar/desativar notificações nativas do navegador
  btnNotifyToggle.addEventListener('click', async () => {
    const currentPresetId = presetSelector.value;
    if (currentPresetId === 'none') return;

    const isEnabled = localStorage.getItem(`notify-preset-${currentPresetId}`) === 'true';

    if (!isEnabled) {
      // Solicita permissão se ainda não foi concedida
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          localStorage.setItem(`notify-preset-${currentPresetId}`, 'true');
          updateNotifyButtonState(currentPresetId);
          showToast('Alertas ativados! Avisaremos você 5 min antes.', 'success');
        } else {
          showToast('Permissão de notificação negada pelo navegador.', 'error');
        }
      } else {
        showToast('Seu navegador não suporta notificações.', 'error');
      }
    } else {
      // Desativa
      localStorage.setItem(`notify-preset-${currentPresetId}`, 'false');
      updateNotifyButtonState(currentPresetId);
      showToast('Alertas desativados para este trajeto.', 'info');
    }
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
 * Atualiza visualmente o ícone e a classe do botão de notificação baseado no preset ativo.
 */
function updateNotifyButtonState(presetId: string): void {
  const btnNotifyToggle = document.getElementById('btn-notify-toggle') as HTMLButtonElement;
  if (!btnNotifyToggle || presetId === 'none') return;

  const isEnabled = localStorage.getItem(`notify-preset-${presetId}`) === 'true';
  const hasPermission = 'Notification' in window && Notification.permission === 'granted';

  if (isEnabled && hasPermission) {
    btnNotifyToggle.innerHTML = getIcon('bell', 20);
    btnNotifyToggle.classList.add('active');
    btnNotifyToggle.title = 'Alertas Ativos (Clique para desativar)';
  } else {
    btnNotifyToggle.innerHTML = getIcon('bellOff', 20);
    btnNotifyToggle.classList.remove('active');
    btnNotifyToggle.title = 'Ativar Alertas de Chegada';
    if (isEnabled && !hasPermission) {
      // Se estava habilitado mas perdeu a permissão, desliga
      localStorage.setItem(`notify-preset-${presetId}`, 'false');
    }
  }
}

/**
 * Busca por uma viagem que tenha sido iniciada hoje e não tenha horário de chegada no destino.
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
    <div class="card empty-state" style="padding: 32px 16px;">
      <div class="empty-state-icon" style="color: var(--accent);">${getIcon('mapPin', 40)}</div>
      <div class="empty-state-title" style="margin-top: 12px;">Nenhum trajeto configurado</div>
      <div class="empty-state-desc">
        Crie linhas, pontos e configure um trajeto personalizado na aba "Gerenciar" para ver previsões aqui.
      </div>
      <a href="#manage" class="btn btn-primary" style="margin-top: 16px;">Configurar Trajetos</a>
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
  const predictions = findNextBuses(preset, schedules, presetRecords, currentDayType, 3);
  const prediction = predictions[0];

  if (!prediction) {
    container.innerHTML = `
      <div class="card">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <span style="color: var(--accent);">${getIcon(preset.icon, 28)}</span>
          <div>
            <h2 style="margin-bottom: 2px; font-size: 16px;">${preset.name}</h2>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="record-line-badge" style="background-color: ${line.color};">${line.number}</span>
              <span style="font-size: 12px; color: var(--text-secondary);">${line.name}</span>
            </div>
          </div>
        </div>
        <div class="empty-state" style="padding: 32px 0;">
          <div class="empty-state-icon" style="color: var(--text-secondary);">${getIcon('clock', 36)}</div>
          <div class="empty-state-title" style="margin-top: 12px;">Sem ônibus hoje</div>
          <div class="empty-state-desc">Não há mais ônibus programados na tabela de horários para o dia de hoje nesta linha.</div>
        </div>
      </div>
    `;
    return;
  }

  // Calcula os minutos restantes até a chegada prevista
  const minutesLeft = minutesUntilArrival(prediction);

  // Lógica de Notificações nativas no celular
  const isNotifEnabled = localStorage.getItem(`notify-preset-${preset.id}`) === 'true';
  if (isNotifEnabled && 'Notification' in window && Notification.permission === 'granted') {
    // Alerta disparado quando o ônibus está entre 1 e 5 minutos de distância
    if (minutesLeft > 0 && minutesLeft <= 5) {
      const notifiedKey = `${preset.id}-${prediction.scheduledDeparture}-${currentDate()}`;
      if (!notifiedTrips[notifiedKey]) {
        notifiedTrips[notifiedKey] = true;
        new Notification('BusTracker: Ônibus Chegando!', {
          body: `O ônibus do trajeto "${preset.name}" (Linha ${line.number}) está previsto para chegar em ${minutesLeft} min (às ${prediction.predictedBusArrival}). Vá para o ponto!`,
          icon: '/favicon.ico'
        });
      }
    }
  }

  // Calcula margem de segurança (Buffer Time)
  const buffer = preset.bufferTime ?? 0;
  const walkTime = preset.estimatedBoardingOffset;
  const totalOffset = walkTime + buffer;
  const timeToLeave = addMinutes(prediction.predictedBusArrival, -totalOffset);
  const minutesToLeave = timeDiffMinutes(currentTime(), timeToLeave);

  // Renderiza os componentes de UI
  const countdownHtml = renderCountdown(minutesLeft);
  const confidenceHtml = renderConfidence(prediction.confidence, prediction.recordCount, prediction.reliability);
  const isTripInProgress = activeTripRecord !== null;

  // Renderização da seção recomendada de saída
  let leaveHtml = '';
  if (!isTripInProgress && minutesLeft > 0) {
    let leaveStatusText = '';
    let leaveColorStyle = 'var(--success)';
    let pulseClass = 'pulse-green';

    if (minutesToLeave < 0) {
      leaveStatusText = 'Atrasado! Vá correndo';
      leaveColorStyle = 'var(--danger)';
      pulseClass = 'pulse-red';
    } else if (minutesToLeave === 0) {
      leaveStatusText = 'Saia agora!';
      leaveColorStyle = 'var(--warning)';
      pulseClass = 'pulse-yellow';
    } else if (minutesToLeave <= 3) {
      leaveStatusText = `Saia em ${minutesToLeave} min`;
      leaveColorStyle = 'var(--warning)';
      pulseClass = 'pulse-yellow';
    } else {
      leaveStatusText = `Saia em ${minutesToLeave} min`;
      leaveColorStyle = 'var(--success)';
      pulseClass = 'pulse-green';
    }

    leaveHtml = `
      <div class="card countdown-container ${pulseClass}" style="background-color: var(--bg); margin: 0 0 16px 0; padding: 12px 14px; border-radius: var(--radius); display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="color: var(--accent); display: flex;">${getIcon('clock', 20)}</span>
          <div>
            <span class="label" style="font-size: 9px; margin-bottom: 0; letter-spacing: 0.02em;">Sair de Casa às</span>
            <strong style="font-size: 15px; color: var(--text);">${timeToLeave}</strong>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 10px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Buffer: ${buffer}m | Caminhada: ${walkTime}m</span>
          <strong style="font-size: 13px; color: ${leaveColorStyle};">${leaveStatusText}</strong>
        </div>
      </div>
    `;
  }

  // Gera o HTML para os próximos ônibus da sequência
  let nextBusesGridHtml = '';
  if (predictions.length > 1) {
    const extraPredictions = predictions.slice(1);
    const cols = extraPredictions.map(pred => {
      const minLeft = timeDiffMinutes(currentTime(), pred.predictedBusArrival);
      const confColor = pred.confidence >= 75 ? 'var(--success)' : pred.confidence >= 40 ? 'var(--warning)' : 'var(--danger)';
      return `
        <div class="card" style="margin-bottom: 0; padding: 10px 12px; background-color: var(--surface); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px;">
          <span class="label" style="font-size: 8px; margin-bottom: 0; letter-spacing: 0.03em; color: var(--text-secondary);">Na sequência</span>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px;">
            <strong style="font-size: 14px; color: var(--text);">~${pred.predictedBusArrival}</strong>
            <span style="font-size: 11px; color: var(--text-secondary); font-family: monospace;">Tabela: ${pred.scheduledDeparture}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 10px;">
            <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 2px;">
              ${getIcon('clock', 10)} em ${minLeft} min
            </span>
            <span style="font-weight: 600; color: ${confColor};">
              ${Math.round(pred.confidence)}% conf.
            </span>
          </div>
        </div>
      `;
    }).join('');

    nextBusesGridHtml = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px;">
        ${cols}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card" style="margin-bottom: 16px; position: relative;">
      <!-- Cabeçalho do Preset -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="color: var(--accent); display: flex;">${getIcon(preset.icon, 32)}</span>
          <div>
            <h2 style="margin-bottom: 2px; font-size: 16px; font-weight: 700;">${preset.name}</h2>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="record-line-badge" style="background-color: ${line.color};">${line.number}</span>
              <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">${line.name}</span>
            </div>
          </div>
        </div>
        <div style="text-align: right;">
          <span class="label" style="margin-bottom: 2px; font-size: 10px;">Tabela</span>
          <span style="font-size: 16px; font-weight: 700; color: var(--text);">${prediction.scheduledDeparture}</span>
        </div>
      </div>

      <!-- Barra de Rotas (Origem -> Destino) -->
      <div style="position: relative; padding-left: 20px; margin-bottom: 18px;">
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

      <!-- Componente do Contador Principal -->
      ${countdownHtml}

      <!-- Recomendação de Saída baseada na caminhada + margem de segurança -->
      ${leaveHtml}

      <!-- Horários previstos com intervalo de confiança -->
      ${renderConfidenceInterval(prediction.predictedBusArrival, prediction.confidenceInterval)}

      <div class="card" style="background-color: var(--bg); margin: 0 0 14px 0; padding: 12px; border-radius: var(--radius);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
            ${getIcon('mapPin', 13)} Previsão no Ponto:
          </span>
          <span style="font-size: 13px; font-weight: 700; color: var(--text);">~${prediction.predictedBusArrival}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
            ${getIcon('arrowRight', 13)} Previsão no Destino:
          </span>
          <span style="font-size: 13px; font-weight: 700; color: var(--success);">
            ${prediction.predictedDestinationArrival ? `~${prediction.predictedDestinationArrival}` : 'Sem histórico'}
          </span>
        </div>
        <!-- Badges de tendência e outliers -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
          ${renderTrendBadge(prediction.trendDirection, prediction.trendStrength)}
          ${renderOutlierBadge(prediction.outlierCount)}
        </div>
      </div>

      <!-- Barra de Confiança -->
      ${confidenceHtml}
    </div>

    <!-- Próximos ônibus na sequência -->
    ${nextBusesGridHtml}

    <!-- Botões de Registro -->
    <div style="margin-top: 16px;">
      ${isTripInProgress 
        ? `<button class="btn btn-success btn-lg" id="btn-arrive-destination" style="box-shadow: 0 4px 12px rgba(34, 197, 94, 0.25); width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
            ${getIcon('check', 18)} Cheguei no Destino!
           </button>`
        : `<button class="btn btn-primary btn-lg" id="btn-bus-arrived" style="box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25); width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
            ${getIcon('bus', 18)} Ônibus Chegou!
           </button>`
      }
    </div>
  `;

  // Anexa listeners de eventos aos botões
  const btnBusArrived = document.getElementById('btn-bus-arrived');
  const btnArriveDestination = document.getElementById('btn-arrive-destination');

  if (btnBusArrived) {
    btnBusArrived.addEventListener('click', async () => {
      // Registra a chegada do ônibus no ponto
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const nowStr = `${h}:${m}`;
      const nowWithSecondsStr = `${h}:${m}:${s}`;
      const currentDayType = detectDayType(now);

      // Busca tabelas de horários do dia
      const daySchedules = await getSchedulesByLine(preset.lineId, currentDayType);

      if (daySchedules.length === 0) {
        showToast('Nenhum horário cadastrado nesta linha para hoje.', 'error');
        return;
      }

      // Calcula as diferenças absolutas em minutos para cada horário
      const schedulesWithDiff = daySchedules.map(schedule => {
        return {
          schedule,
          diff: Math.abs(timeDiffMinutes(schedule.departureTime, nowStr))
        };
      }).sort((a, b) => a.diff - b.diff);

      let chosenSchedule = schedulesWithDiff[0].schedule;
      
      // Se houver mais de um horário e ambos estiverem a menos de 20 minutos de agora, há ambiguidade
      const isAmbiguous = schedulesWithDiff.length > 1 && 
                         schedulesWithDiff[0].diff <= 20 && 
                         schedulesWithDiff[1].diff <= 20;

      if (isAmbiguous) {
        const opt1 = schedulesWithDiff[0].schedule.departureTime;
        const opt2 = schedulesWithDiff[1].schedule.departureTime;
        const chooseFirst = window.confirm(
          `Identificamos dois horários próximos da tabela.\n\n` +
          `Clique em OK para registrar para a saída das ${opt1}\n` +
          `ou CANCELAR para registrar para a saída das ${opt2}.`
        );
        chosenSchedule = chooseFirst ? schedulesWithDiff[0].schedule : schedulesWithDiff[1].schedule;
      } else {
        const confirmReg = window.confirm(
          `Deseja registrar o embarque para o ônibus com saída programada das ${chosenSchedule.departureTime}?`
        );
        if (!confirmReg) return; // Cancela o registro
      }

      // Cria o registro da viagem
      const record: TripRecord = {
        id: generateId(),
        presetId: preset.id,
        date: currentDate(),
        dayOfWeek: now.getDay(),
        dayType: currentDayType,
        scheduledDeparture: chosenSchedule.departureTime,
        busArrivedAt: nowWithSecondsStr
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
