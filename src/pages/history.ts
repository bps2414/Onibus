// ============================================================
// history.ts — Histórico de Viagens Registradas
// ============================================================

import { getAll, remove, getById } from '../db/database';
import { TripRecord, Preset, BusLine } from '../types';
import { formatDate, dayName, timeDiffMinutes, formatMinutes } from '../utils/time';
import { getDayOfWeek } from '../utils/helpers';
import { showToast } from '../components/toast';
import { showModal } from '../components/modal';

/**
 * Renderiza o esqueleto HTML da página de histórico com seletor de filtros.
 * 
 * @returns String contendo o HTML básico
 */
export async function renderHistoryPage(): Promise<string> {
  return `
    <div class="app-header">
      <div class="app-title">Histórico de Viagens</div>
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
 * Inicializa a escuta de eventos e carrega os filtros de presets.
 */
export async function initHistoryPage(): Promise<void> {
  const filterSelect = document.getElementById('history-preset-filter') as HTMLSelectElement;
  if (!filterSelect) return;

  // Busca todos os trajetos (presets) salvos para popular o dropdown
  const presets = await getAll<Preset>('presets');
  
  // Limpa opções antigas, exceto a primeira "Todos"
  filterSelect.innerHTML = '<option value="all">Mostrar todos os trajetos</option>';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.icon} ${p.name}`;
    filterSelect.appendChild(opt);
  });

  // Atualiza a lista inicialmente
  await renderList('all');

  // Adiciona listener para recarregar a lista ao alterar o filtro
  filterSelect.addEventListener('change', async () => {
    await renderList(filterSelect.value);
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

  // Filtra registros pelo preset selecionado
  const filteredRecords = presetFilter === 'all'
    ? records
    : records.filter(r => r.presetId === presetFilter);

  if (filteredRecords.length === 0) {
    container.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">Nenhuma viagem registrada</div>
        <div class="empty-state-desc">
          ${presetFilter === 'all' 
            ? 'Clique em "🚌 Ônibus Chegou!" na página inicial para começar a registrar suas viagens.'
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
      <div class="history-date-group">
        <div class="history-date-header">${headerText}</div>
    `;

    for (const record of groups[dateStr]) {
      const preset = presets.find(p => p.id === record.presetId);
      const line = preset ? lines.find(l => l.id === preset.lineId) : null;
      
      const presetName = preset ? `${preset.icon} ${preset.name}` : 'Trajeto Deletado';
      const lineBadgeColor = line ? line.color : 'var(--border)';
      const lineNumber = line ? line.number : '??';

      // Calcula diferença (real - programado)
      const diff = timeDiffMinutes(record.scheduledDeparture, record.busArrivedAt);
      let diffText = '';
      let diffClass = 'green';

      if (diff > 0) {
        diffText = `+${diff}min atrasado`;
        diffClass = 'red';
      } else if (diff < 0) {
        diffText = `${Math.abs(diff)}min adiantado`;
        diffClass = 'green';
      } else {
        diffText = 'No horário';
        diffClass = 'green';
      }

      // Calcula a duração da viagem se tiver chegado ao destino
      let durationText = '';
      if (record.arrivedAtDestination) {
        const tripMinutes = timeDiffMinutes(record.busArrivedAt, record.arrivedAtDestination);
        durationText = `⏱️ Viagem: ${formatMinutes(tripMinutes)}`;
      } else {
        durationText = '📍 Destino não registrado';
      }

      html += `
        <div class="record-item">
          <div class="record-info">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="record-line-badge" style="background-color: ${lineBadgeColor}; font-size: 9px; padding: 1px 4px;">${lineNumber}</span>
              <strong style="font-size: 13px;">${presetName}</strong>
            </div>
            <div class="record-times" style="margin-top: 4px;">
              ${record.scheduledDeparture} ➡️ <span style="color: var(--text);">${record.busArrivedAt}</span>
            </div>
            <div class="record-duration" style="margin-top: 2px;">
              ${durationText}
            </div>
          </div>
          
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
            <span class="record-diff ${diffClass}">${diffText}</span>
            <button class="list-item-btn delete delete-record-btn" data-id="${record.id}" style="padding: 2px 4px;" title="Excluir Registro">🗑️</button>
          </div>
        </div>
      `;
    }

    html += `</div>`; // fecha history-date-group
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
