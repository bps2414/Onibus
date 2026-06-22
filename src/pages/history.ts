// ============================================================
// history.ts — Histórico de Viagens Registradas
// ============================================================

import { getAll, remove, getById, put, getSchedulesByLine } from '../db/database';
import { TripRecord, Preset, BusLine, BusStop, Schedule } from '../types';
import { formatDate, dayName, timeDiffMinutes, formatMinutes } from '../utils/time';
import { getDayOfWeek, generateId, detectDayType } from '../utils/helpers';
import { showToast } from '../components/toast';
import { showModal, closeModal } from '../components/modal';
import { getIcon } from '../components/icons';
import { calculatePresetBaselines, getRecordDelay } from '../services/statistics';

/**
 * Renderiza o esqueleto HTML da página de histórico com seletor de filtros e botão de adição.
 * 
 * @returns String contendo o HTML básico
 */
export async function renderHistoryPage(): Promise<string> {
  const plusIcon = getIcon('plus', 14);

  return `
    <div class="app-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <div class="app-title" style="margin-bottom: 0;">Histórico</div>
      <button class="btn btn-primary" id="btn-add-trip-manual" style="padding: 6px 12px; font-size: 13px; display: flex; align-items: center; gap: 4px;">
        ${plusIcon} Registrar Manual
      </button>
    </div>

    <!-- Filtro por Trajeto -->
    <div class="card" style="margin-bottom: 20px; padding: 12px 16px;">
      <label class="label" for="history-preset-filter">Filtrar por Trajeto</label>
      <select class="select" id="history-preset-filter" style="margin-bottom: 0;">
        <option value="all">Mostrar todos os trajetos</option>
      </select>
    </div>

    <!-- Container da lista de registros -->
    <div id="history-records-list">
      <p style="text-align: center; padding: 24px 0;">Carregando histórico...</p>
    </div>
  `;
}

/**
 * Inicializa a escuta de eventos, carrega os filtros de presets e abre modal manual.
 */
export async function initHistoryPage(): Promise<void> {
  const filterSelect = document.getElementById('history-preset-filter') as HTMLSelectElement;
  const btnAddTripManual = document.getElementById('btn-add-trip-manual') as HTMLButtonElement;
  if (!filterSelect) return;

  // Busca todos os trajetos (presets) salvos para popular o dropdown
  const presets = await getAll<Preset>('presets');
  
  // Limpa opções antigas, exceto a primeira "Todos"
  filterSelect.innerHTML = '<option value="all">Mostrar todos os trajetos</option>';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    filterSelect.appendChild(opt);
  });

  // Atualiza a lista inicialmente
  await renderList('all');

  // Adiciona listener para recarregar a lista ao alterar o filtro
  filterSelect.addEventListener('change', async () => {
    await renderList(filterSelect.value);
  });

  // Botão para registrar viagem passada
  if (btnAddTripManual) {
    btnAddTripManual.addEventListener('click', () => {
      openAddManualTripModal(filterSelect.value);
    });
  }
}

/**
 * Abre o modal de formulário para cadastro de viagem passada manualmente.
 */
async function openAddManualTripModal(currentFilter: string): Promise<void> {
  const presets = await getAll<Preset>('presets');

  if (presets.length === 0) {
    showToast('Configure pelo menos um trajeto na aba Gerenciar primeiro.', 'error');
    return;
  }

  // Define a data padrão de hoje no formato YYYY-MM-DD local
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  const localISODate = new Date(now.getTime() - tzOffset).toISOString().split('T')[0];

  const formHtml = `
    <form id="manual-trip-form">
      <label class="label" for="manual-preset-select">Selecione o Trajeto</label>
      <select class="select" id="manual-preset-select" required>
        <option value="">Selecione um trajeto...</option>
        ${presets.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
      </select>

      <label class="label" for="manual-date">Data da Viagem</label>
      <input type="date" id="manual-date" class="input" value="${localISODate}" max="${localISODate}" required />

      <label class="label" for="manual-schedule-select">Horário Programado da Tabela</label>
      <select class="select" id="manual-schedule-select" required disabled>
        <option value="">Escolha o trajeto primeiro...</option>
      </select>

      <div style="display: flex; gap: 8px;">
        <div style="flex: 1;">
          <label class="label" for="manual-arrival-stop">Chegada no Ponto</label>
          <input type="time" id="manual-arrival-stop" class="input" required />
        </div>
        <div style="flex: 1;">
          <label class="label" for="manual-arrival-destination">Chegada no Destino</label>
          <input type="time" id="manual-arrival-destination" class="input" placeholder="Opcional" />
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button type="submit" class="btn btn-primary" style="flex: 1;">Salvar Viagem</button>
      </div>
    </form>
  `;

  showModal('Registrar Viagem Passada', formHtml);

  // Manipula elementos injetados no DOM do modal
  const form = document.getElementById('manual-trip-form') as HTMLFormElement;
  const presetSelect = document.getElementById('manual-preset-select') as HTMLSelectElement;
  const dateInput = document.getElementById('manual-date') as HTMLInputElement;
  const scheduleSelect = document.getElementById('manual-schedule-select') as HTMLSelectElement;

  // Função para carregar os horários programados da tabela baseados no trajeto e tipo de dia
  const updateSchedules = async () => {
    const presetId = presetSelect.value;
    const dateVal = dateInput.value;
    
    if (!presetId || !dateVal) {
      scheduleSelect.disabled = true;
      scheduleSelect.innerHTML = '<option value="">Escolha o trajeto e data...</option>';
      return;
    }

    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    // Calcula o tipo de dia correto baseado na data selecionada
    const [y, m, d] = dateVal.split('-').map(Number);
    const selectedDateObj = new Date(y, m - 1, d);
    const dayType = detectDayType(selectedDateObj);

    const schedules = await getSchedulesByLine(preset.lineId, dayType);

    scheduleSelect.innerHTML = '';
    if (schedules.length === 0) {
      scheduleSelect.disabled = true;
      scheduleSelect.innerHTML = '<option value="">Sem horários na tabela para este dia</option>';
      return;
    }

    scheduleSelect.disabled = false;
    // Ordena os horários programados
    schedules.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
    schedules.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.departureTime;
      opt.textContent = `${s.departureTime}`;
      scheduleSelect.appendChild(opt);
    });
  };

  presetSelect.addEventListener('change', updateSchedules);
  dateInput.addEventListener('change', updateSchedules);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const presetId = presetSelect.value;
    const dateVal = dateInput.value;
    const scheduleVal = scheduleSelect.value;
    const arrivalStopVal = (document.getElementById('manual-arrival-stop') as HTMLInputElement).value;
    const arrivalDestVal = (document.getElementById('manual-arrival-destination') as HTMLInputElement).value;

    if (!presetId || !dateVal || !scheduleVal || !arrivalStopVal) {
      showToast('Por favor, preencha todos os campos obrigatórios.', 'error');
      return;
    }

    const preset = presets.find(p => p.id === presetId)!;
    
    // Calcula o dia da semana (0-6)
    const [y, m, d] = dateVal.split('-').map(Number);
    const selectedDateObj = new Date(y, m - 1, d);
    const dayOfWeek = selectedDateObj.getDay();
    const dayType = detectDayType(selectedDateObj);

    const record: TripRecord = {
      id: generateId(),
      presetId,
      date: dateVal,
      dayOfWeek,
      dayType,
      scheduledDeparture: scheduleVal,
      busArrivedAt: arrivalStopVal,
      arrivedAtDestination: arrivalDestVal || undefined
    };

    await put('tripRecords', record);
    showToast('Viagem cadastrada manualmente no histórico!', 'success');
    closeModal();

    // Recarrega listagem na tela principal
    await renderList(currentFilter);
  });
}

/**
 * Carrega registros, filtra, ordena e renderiza agrupado por data.
 * 
 * @param presetFilter - ID do preset para filtrar ou 'all'
 */
async function renderList(presetFilter: string): Promise<void> {
  const container = document.getElementById('history-records-list');
  if (!container) return;

  // Carrega registros, presets e linhas em paralelo
  const [records, presets, lines] = await Promise.all([
    getAll<TripRecord>('tripRecords'),
    getAll<Preset>('presets'),
    getAll<BusLine>('busLines')
  ]);

  const baselines = calculatePresetBaselines(records);

  // Filtra registros pelo preset selecionado
  const filteredRecords = presetFilter === 'all'
    ? records
    : records.filter(r => r.presetId === presetFilter);

  if (filteredRecords.length === 0) {
    const listIconSvg = getIcon('history', 36, 'empty-state-icon');
    container.innerHTML = `
      <div class="card empty-state" style="padding: 32px 16px;">
        <div class="empty-state-icon" style="color: var(--text-secondary);">${listIconSvg}</div>
        <div class="empty-state-title" style="margin-top: 12px;">Nenhuma viagem registrada</div>
        <div class="empty-state-desc">
          ${presetFilter === 'all' 
            ? 'Clique em "🚌 Ônibus Chegou!" na página inicial ou use o botão "Registrar Manual" para começar a preencher seus dados.'
            : 'Nenhuma viagem gravada neste trajeto específico ainda.'
          }
        </div>
      </div>
    `;
    return;
  }

  // Ordena os registros: data descrescente e depois hora real de chegada descrescente
  const sortedRecords = filteredRecords.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return b.busArrivedAt.localeCompare(a.busArrivedAt);
  });

  // Agrupa os registros pela string de data
  const groups: Record<string, TripRecord[]> = {};
  sortedRecords.forEach(rec => {
    if (!groups[rec.date]) {
      groups[rec.date] = [];
    }
    groups[rec.date].push(rec);
  });

  // Gera o HTML acumulado
  let html = '';

  for (const dateStr of Object.keys(groups)) {
    const dayOfWeek = getDayOfWeek(dateStr);
    const headerText = `${formatDate(dateStr)} — ${dayName(dayOfWeek)}`;

    html += `
      <div class="history-date-group" style="margin-bottom: 24px;">
        <div class="history-date-header" style="font-size: 11px; font-weight: 750; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 14px; letter-spacing: 0.08em; padding-bottom: 4px; border-bottom: 1px solid var(--border);">${headerText}</div>
        <div class="timeline-wrapper" style="margin: 8px 0 8px 6px;">
          <div class="timeline-line"></div>
    `;

    for (const record of groups[dateStr]) {
      const preset = presets.find(p => p.id === record.presetId);
      const line = preset ? lines.find(l => l.id === preset.lineId) : null;
      
      const presetName = preset ? preset.name : 'Trajeto Deletado';
      const presetIconSvg = preset ? getIcon(preset.icon, 18, 'record-preset-icon') : getIcon('bus', 18);
      const lineBadgeColor = line ? line.color : 'var(--border)';
      const lineNumber = line ? line.number : '??';

      // Calcula diferença inteligente baseada no baseline
      const diff = Math.round(getRecordDelay(record, baselines));
      let diffText = '';
      let diffClass = 'green';

      if (diff > 0) {
        diffText = `+${diff} min atrasado`;
        diffClass = 'red';
      } else if (diff < 0) {
        diffText = `${Math.abs(diff)} min adiantado`;
        diffClass = 'green';
      } else {
        diffText = 'No horário';
        diffClass = 'green';
      }

      // Calcula a duração da viagem se tiver chegado ao destino
      let durationText = '';
      if (record.arrivedAtDestination) {
        const tripMinutes = timeDiffMinutes(record.busArrivedAt, record.arrivedAtDestination);
        durationText = `Viagem: ${formatMinutes(tripMinutes)}`;
      } else {
        durationText = 'Destino não registrado';
      }

      const trashIconSvg = getIcon('trash', 12);
      const arrowIconSvg = getIcon('arrowRight', 11);

      html += `
        <div class="timeline-node" style="margin-bottom: 20px;">
          <div class="timeline-dot" style="border-color: ${lineBadgeColor}; background-color: var(--surface);"></div>
          <div class="timeline-content" style="display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; padding-left: 8px; width: 100%;">
            <div class="record-info">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span class="record-line-badge" style="background-color: ${lineBadgeColor}; font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; color: #ffffff; align-self: center;">${lineNumber}</span>
                <span style="color: var(--accent); display: flex;">${presetIconSvg}</span>
                <strong style="font-size: 13.5px; color: var(--text);">${presetName}</strong>
              </div>
              <div class="record-times" style="margin-top: 6px; font-size: 12.5px; color: var(--text-secondary);">
                Tabela: <strong style="color: var(--text);">${record.scheduledDeparture}</strong> ${arrowIconSvg} Ponto: <strong style="color: var(--text);">${record.busArrivedAt}</strong>
              </div>
              <div class="record-duration" style="margin-top: 4px; font-size: 11.5px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                ${getIcon('clock', 12)} ${durationText}
              </div>
            </div>
            
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; margin-left: 12px; flex-shrink: 0;">
              <span class="record-diff ${diffClass}" style="font-size: 10px; font-weight: 800; padding: 3px 7px; border-radius: 4px; letter-spacing: 0.01em; text-transform: uppercase;">${diffText}</span>
              <button class="list-item-btn delete delete-record-btn" data-id="${record.id}" style="padding: 4px;" title="Excluir Registro">
                ${trashIconSvg}
              </button>
            </div>
          </div>
        </div>
      `;
    }

    html += `
        </div> <!-- fecha timeline-wrapper -->
      </div> <!-- fecha history-date-group -->
    `;
  }

  container.innerHTML = html;

  // Anexa listeners para exclusão de registros
  container.querySelectorAll('.delete-record-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')!;
      showModal(
        'Excluir Registro',
        'Deseja realmente apagar esta viagem do seu histórico de aprendizado?',
        async () => {
          await remove('tripRecords', id);
          showToast('Registro de viagem excluído!', 'success');
          // Recarrega a lista preservando o filtro ativo
          await renderList(presetFilter);
        }
      );
    });
  });
}
