// ============================================================
// home.ts — Tela principal do BusTracker (Rastreamento e Previsão)
// ============================================================

import { getSettings, saveSettings, getAll, getById, put, getSchedulesByLine } from '../db/database';
import { Preset, TripRecord, BusLine, BusStop, Schedule, Prediction } from '../types';
import { findNextBuses, minutesUntilArrival, predictArrival } from '../services/prediction';
import { currentTime, currentDate, formatMinutes, timeDiffMinutes, addMinutes } from '../utils/time';
import { generateId, detectDayType } from '../utils/helpers';
import { renderCountdown } from '../components/countdown';
import { renderConfidence } from '../components/confidence';
import { renderConfidenceInterval, renderTrendBadge, renderOutlierBadge } from '../components/confidence-interval';
import { showToast } from '../components/toast';
import { renderThemeToggle, initThemeToggle } from '../components/theme-toggle';
import { getIcon } from '../components/icons';

// Guarda o ID do registro de viagem em andamento
let activeTripRecord: TripRecord | null = null;

// Objeto na memória para evitar múltiplos disparos de notificação para a mesma viagem no mesmo dia
const notifiedTrips: Record<string, boolean> = {};

// Cache do estado atual para evitar rebuilds desnecessários no tick
let lastRenderedState: {
  presetId: string;
  scheduledDeparture: string;
  isTripInProgress: boolean;
  predictionsCount: number;
} | null = null;

// Cache dos dados carregados para reutilizar no tick sem recarregar do DB
let cachedTickData: {
  preset: Preset;
  line: BusLine;
  boardingStop: BusStop;
  destinationStop: BusStop;
  schedules: Schedule[];
  presetRecords: TripRecord[];
} | null = null;

/**
 * Renderiza o HTML esqueleto da página Home.
 * 
 * @returns String contendo o HTML básico
 */
export async function renderHomePage(): Promise<string> {
  const themeToggleHtml = renderThemeToggle();

  const calendarIconSvg = `
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="18" 
      height="18" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round" 
      stroke-linejoin="round" 
      style="display: inline-block; vertical-align: middle;"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  `;

  return `
    <div class="app-header">
      <div class="app-title">
        <span>${getIcon('bus', 24, 'app-title-icon')} Bus<span class="app-title-accent">Tracker</span></span>
      </div>
      ${themeToggleHtml}
    </div>

    <!-- Container para o Banner de Instalação do PWA -->
    <div id="pwa-install-container"></div>

    <!-- Mostrador de Data e Horário em Tempo Real -->
    <div class="card" id="datetime-display-card" style="margin-bottom: 20px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, var(--surface) 0%, var(--bg) 100%); border-left: 4px solid var(--accent); box-shadow: var(--shadow-sm);">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--accent); display: flex; align-items: center;">${calendarIconSvg}</span>
        <span id="live-date" style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">Carregando data...</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--accent); display: flex; align-items: center;">${getIcon('clock', 18)}</span>
        <strong id="live-time" style="font-size: 14px; font-weight: 700; color: var(--text); font-family: var(--font-mono, monospace);">00:00:00</strong>
      </div>
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
 * Renderiza e gerencia o banner de instalação do PWA se aplicável.
 */
function handlePwaInstallBanner(): void {
  const container = document.getElementById('pwa-install-container');
  if (!container) return;

  const deferredPrompt = (window as any).deferredPrompt;
  const isDismissed = sessionStorage.getItem('pwa-banner-dismissed') === 'true';

  // Se não temos o prompt de instalação disponível ou se o usuário já fechou nesta sessão
  if (!deferredPrompt || isDismissed) {
    container.innerHTML = '';
    return;
  }

  // Desenha o banner
  container.innerHTML = `
    <div class="card pwa-banner" style="margin-bottom: 20px; padding: 16px; display: flex; flex-direction: column; gap: 12px; border-left: 4px solid var(--accent); background: var(--surface); animation: fadeIn 0.3s ease;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; gap: 12px; align-items: center;">
          <div style="color: var(--accent); display: flex; align-items: center;">
            ${getIcon('import', 24)}
          </div>
          <div>
            <h4 style="font-weight: 600; font-size: 15px; margin-bottom: 2px;">Instalar o BoraBus</h4>
            <p style="font-size: 13px; color: var(--text-secondary);">Acesse mais rápido e use 100% offline direto da tela inicial.</p>
          </div>
        </div>
        <button id="btn-pwa-dismiss" class="btn-icon" style="padding: 4px; margin: -4px -4px 0 0; color: var(--text-secondary);" title="Fechar">
          ${getIcon('close', 18)}
        </button>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="btn-pwa-install" class="btn-primary" style="padding: 6px 16px; font-size: 13px; border-radius: var(--radius-sm);">Instalar</button>
      </div>
    </div>
  `;

  const btnInstall = document.getElementById('btn-pwa-install');
  const btnDismiss = document.getElementById('btn-pwa-dismiss');

  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      const promptEvent = (window as any).deferredPrompt;
      if (!promptEvent) return;

      // Dispara o prompt de instalação nativo
      promptEvent.prompt();

      // Aguarda a resposta do usuário
      const { outcome } = await promptEvent.userChoice;
      console.log(`[BoraBus PWA] Usuário respondeu ao prompt com: ${outcome}`);

      // Limpa o prompt para não ser reutilizado
      (window as any).deferredPrompt = null;
      container.innerHTML = '';
    });
  }

  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      // Salva na sessão para não perturbar o usuário nesta sessão
      sessionStorage.setItem('pwa-banner-dismissed', 'true');
      container.innerHTML = '';
    });
  }
}

/**
 * Envia uma mensagem para o Service Worker para agendar ou cancelar um alarme.
 */
function sendAlarmToServiceWorker(
  presetId: string,
  delayMs: number,
  scheduledTime: string,
  lineName: string,
  isCancellation = false
): void {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return;
  }

  if (isCancellation) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CANCEL_ALARM',
      id: presetId
    });
    return;
  }

  // Prepara o título e o corpo da notificação
  const title = 'BoraBus: Ônibus Chegando!';
  const body = `Seu ônibus do trajeto (Linha ${lineName}) está previsto para chegar em breve (às ${scheduledTime}). Vá para o ponto!`;

  navigator.serviceWorker.controller.postMessage({
    type: 'SCHEDULE_ALARM',
    id: presetId,
    delayMs,
    title,
    body
  });
}

/**
 * Inicializa a lógica da página Home.
 * Popula o seletor de presets, escuta mudanças, registra as notificações e inicia o intervalo do timer.
 */
export async function initHomePage(): Promise<void> {
  const presetSelector = document.getElementById('preset-selector') as HTMLSelectElement;
  const btnNotifyToggle = document.getElementById('btn-notify-toggle') as HTMLButtonElement;
  if (!presetSelector || !btnNotifyToggle) return;

  // Limpa listener do PWA antigo se existir para evitar vazamento de memória
  if ((window as any).pwaInstallListener) {
    window.removeEventListener('can-install-pwa', (window as any).pwaInstallListener);
  }

  // Define e adiciona o novo listener para atualizar o banner reativamente
  const canInstallListener = () => {
    handlePwaInstallBanner();
  };
  (window as any).pwaInstallListener = canInstallListener;
  window.addEventListener('can-install-pwa', canInstallListener);

  // Busca presets e configurações
  const presets = await getAll<Preset>('presets');
  const settings = await getSettings();

  // Limpa o seletor
  presetSelector.innerHTML = '';

  if (presets.length === 0) {
    presetSelector.innerHTML = '<option value="none">Nenhum trajeto salvo</option>';
    btnNotifyToggle.style.display = 'none';
    renderEmptyState();
    // Renderiza o banner de instalação mesmo em estado vazio
    handlePwaInstallBanner();
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
    
    // Reseta o registro ativo, cache e atualiza visual do sino
    activeTripRecord = null;
    lastRenderedState = null;
    cachedTickData = null;
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
      
      // Cancela o alarme no Service Worker
      sendAlarmToServiceWorker(currentPresetId, 0, '', '', true);
      localStorage.removeItem(`alarm-scheduled-${currentPresetId}`);
      
      showToast('Alertas desativados para este trajeto.', 'info');
    }
  });

  // Verifica se há alguma viagem ativa em andamento no IndexedDB
  await checkForActiveTrip(activePresetId);

  // Executa a primeira renderização do painel de rastreamento
  await updateTrackerView(activePresetId);

  // Renderiza o banner de instalação se elegível
  handlePwaInstallBanner();

  // Faz a primeira atualização instantânea do mostrador de data/hora
  updateLiveDateTime();

  // Limpa qualquer temporizador anterior existente para evitar vazamento de memória e acúmulos
  if ((window as any).boraBusCountdownInterval) {
    window.clearInterval((window as any).boraBusCountdownInterval);
    (window as any).boraBusCountdownInterval = null;
  }

  // Define um intervalo para atualizar apenas os valores dinâmicos (sem reconstruir DOM)
  const intervalId = window.setInterval(() => {
    tickUpdate();
  }, 1000);

  // Compartilha o ID do timer globalmente
  (window as any).boraBusCountdownInterval = intervalId;
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

  // Detecta o tipo de dia e calcula a previsão do próximo ônibus (ou do horário de costume configurado)
  const currentDayType = detectDayType(new Date());
  let prediction: Prediction | null = null;
  let predictions: Prediction[] = [];

  if (preset.preferredScheduleId && preset.preferredScheduleId !== 'none') {
    const preferredSchedule = schedules.find(s => s.id === preset.preferredScheduleId);
    if (preferredSchedule && preferredSchedule.dayType === currentDayType) {
      prediction = predictArrival(preferredSchedule, preset, presetRecords);
      
      // Busca próximos horários a partir do horário de costume
      predictions = findNextBuses(preset, schedules, presetRecords, currentDayType, 3, preferredSchedule.departureTime);
      
      // Garante que o preferido é o primeiro da lista
      if (predictions.length === 0 || predictions[0].scheduledDeparture !== preferredSchedule.departureTime) {
        predictions.unshift(prediction);
      }
    }
  }

  if (!prediction) {
    predictions = findNextBuses(preset, schedules, presetRecords, currentDayType, 3);
    prediction = predictions[0] || null;
  }

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

  // Alertas desativados de tempo de caminhada. Garantimos que nenhum temporizador fique ativo.
  sendAlarmToServiceWorker(preset.id, 0, '', '', true);
  localStorage.removeItem(`alarm-scheduled-${preset.id}`);

  // Calcula se há viagem em andamento (precisa vir antes do cache)
  const isTripInProgress = activeTripRecord !== null;

  // Salva o estado atual para o tick detectar mudanças estruturais
  lastRenderedState = {
    presetId,
    scheduledDeparture: prediction.scheduledDeparture,
    isTripInProgress,
    predictionsCount: predictions.length
  };

  // Salva dados carregados em cache para reutilizar no tick sem recarregar do DB
  cachedTickData = { preset, line, boardingStop, destinationStop, schedules, presetRecords };

  // Renderiza os componentes de UI
  const countdownHtml = renderCountdown(minutesLeft);
  const confidenceHtml = renderConfidence(prediction.confidence, prediction.recordCount, prediction.reliability);

  // Gera o HTML para os próximos ônibus da sequência
  let nextBusesGridHtml = '';
  if (predictions.length > 1) {
    const extraPredictions = predictions.slice(1);
    const cols = extraPredictions.map((pred, idx) => {
      const minLeft = timeDiffMinutes(currentTime(), pred.predictedBusArrival);
      const confColor = pred.confidence >= 75 ? 'var(--success)' : pred.confidence >= 40 ? 'var(--warning)' : 'var(--danger)';
      return `
        <div class="card" data-next-bus-index="${idx}" style="margin-bottom: 0; padding: 10px 12px; background-color: var(--surface); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px;">
          <span class="label" style="font-size: 8px; margin-bottom: 0; letter-spacing: 0.03em; color: var(--text-secondary);">Na sequência</span>
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px;">
            <strong style="font-size: 14px; color: var(--text);">~${pred.predictedBusArrival}</strong>
            <span style="font-size: 11px; color: var(--text-secondary); font-family: monospace;">Tabela: ${pred.scheduledDeparture}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 10px;">
            <span class="next-bus-time" style="color: var(--text-secondary); display: flex; align-items: center; gap: 2px;">
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
      const nowStr = `${h}:${m}`;
      const currentDayType = detectDayType(now);

      const confirmReg = window.confirm(
        `Deseja registrar o embarque para o ônibus com saída programada das ${prediction.scheduledDeparture}?`
      );
      if (!confirmReg) return; // Cancela o registro

      // Cria o registro da viagem
      const record: TripRecord = {
        id: generateId(),
        presetId: preset.id,
        date: currentDate(),
        dayOfWeek: now.getDay(),
        dayType: currentDayType,
        scheduledDeparture: prediction.scheduledDeparture,
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

/**
 * Atualização leve chamada pelo setInterval a cada segundo.
 * Recalcula apenas os valores de texto dinâmicos (countdown, status de saída)
 * sem reconstruir o DOM inteiro. Se detectar mudança estrutural, chama render completo.
 */
/**
 * Atualiza os elementos de data e hora em tempo real na tela.
 */
function updateLiveDateTime(): void {
  const liveDateEl = document.getElementById('live-date');
  const liveTimeEl = document.getElementById('live-time');
  if (liveDateEl || liveTimeEl) {
    const now = new Date();
    if (liveDateEl) {
      const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
      let dateStr = now.toLocaleDateString('pt-BR', dateOptions);
      // Capitaliza a primeira letra
      dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
      liveDateEl.textContent = dateStr;
    }
    if (liveTimeEl) {
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      liveTimeEl.textContent = `${h}:${m}:${s}`;
    }
  }
}

function tickUpdate(): void {
  // Atualiza data e hora a cada segundo
  updateLiveDateTime();

  // Se não há estado renderizado ou dados em cache, não faz nada
  if (!lastRenderedState || !cachedTickData) return;

  const { preset, schedules, presetRecords } = cachedTickData;
  const currentDayType = detectDayType(new Date());

  // Recalcula a previsão atual
  let prediction: Prediction | null = null;
  let predictions: Prediction[] = [];

  if (preset.preferredScheduleId && preset.preferredScheduleId !== 'none') {
    const preferredSchedule = schedules.find(s => s.id === preset.preferredScheduleId);
    if (preferredSchedule && preferredSchedule.dayType === currentDayType) {
      prediction = predictArrival(preferredSchedule, preset, presetRecords);
      predictions = findNextBuses(preset, schedules, presetRecords, currentDayType, 3, preferredSchedule.departureTime);
      if (predictions.length === 0 || predictions[0].scheduledDeparture !== preferredSchedule.departureTime) {
        predictions.unshift(prediction);
      }
    }
  }

  if (!prediction) {
    predictions = findNextBuses(preset, schedules, presetRecords, currentDayType, 3);
    prediction = predictions[0] || null;
  }

  if (!prediction) return;

  // Verifica se houve mudança estrutural (ônibus mudou, viagem começou/terminou)
  const isTripInProgress = activeTripRecord !== null;
  if (
    lastRenderedState.scheduledDeparture !== prediction.scheduledDeparture ||
    lastRenderedState.isTripInProgress !== isTripInProgress ||
    lastRenderedState.predictionsCount !== predictions.length
  ) {
    // Mudança estrutural — rebuild completo
    updateTrackerView(lastRenderedState.presetId);
    return;
  }

  // --- Atualização leve: só textos dinâmicos ---

  const minutesLeft = minutesUntilArrival(prediction);

  // Atualiza o countdown principal
  const countdownEl = document.querySelector('.countdown') as HTMLElement;
  if (countdownEl) {
    let displayValue = '';
    let colorClass = 'green';

    if (minutesLeft < 0) {
      displayValue = 'Passou';
      colorClass = 'red';
    } else if (minutesLeft === 0) {
      displayValue = 'Agora!';
      colorClass = 'red';
    } else if (minutesLeft > 60) {
      const hours = Math.floor(minutesLeft / 60);
      const remainingMinutes = minutesLeft % 60;
      displayValue = `${hours}h ${remainingMinutes}min`;
      colorClass = 'green';
    } else {
      displayValue = `${minutesLeft} min`;
      if (minutesLeft < 5) colorClass = 'red';
      else if (minutesLeft <= 10) colorClass = 'yellow';
    }

    countdownEl.textContent = displayValue;
    countdownEl.className = `countdown ${colorClass}`;
  }



  // Atualiza os cards de "próximos ônibus" (minutos restantes)
  const nextBusCards = document.querySelectorAll('[data-next-bus-index]');
  const extraPredictions = predictions.slice(1);
  nextBusCards.forEach((card, i) => {
    if (i < extraPredictions.length) {
      const pred = extraPredictions[i];
      const minLeft = timeDiffMinutes(currentTime(), pred.predictedBusArrival);
      const timeSpan = card.querySelector('.next-bus-time') as HTMLElement;
      if (timeSpan) timeSpan.textContent = `em ${minLeft} min`;
    }
  });
}
