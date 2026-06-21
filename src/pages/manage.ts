// ============================================================
// manage.ts — Tela de Gerenciamento (Linhas, Pontos, Horários, Presets e Backups)
// ============================================================

import { getAll, put, remove, getSettings, saveSettings, getSchedulesByLine } from '../db/database';
import { BusLine, BusStop, Schedule, Preset } from '../types';
import { generateId } from '../utils/helpers';
import { showToast } from '../components/toast';
import { showModal } from '../components/modal';
import { exportBackup, importBackup } from '../services/backup';
import { getIcon } from '../components/icons';

// Estado de edição local para evitar modais complexos
let editingLineId: string | null = null;
let editingStopId: string | null = null;
let editingPresetId: string | null = null;
let selectedPresetIcon = 'school';

const PRESET_ICONS = ['school', 'home', 'work', 'star', 'heart', 'bus', 'shopping', 'hospital', 'sport'];

/**
 * Renderiza o esqueleto HTML da página de gerenciamento com as 4 abas e o backup.
 * 
 * @returns String contendo o HTML estruturado
 */
export async function renderManagePage(): Promise<string> {
  return `
    <div class="app-header">
      <div class="app-title">Gerenciar Dados</div>
    </div>

    <!-- Abas de navegação -->
    <div class="tabs">
      <button class="tab active" data-tab="lines">Linhas</button>
      <button class="tab" data-tab="stops">Pontos</button>
      <button class="tab" data-tab="schedules">Horários</button>
      <button class="tab" data-tab="presets">Trajetos</button>
    </div>

    <!-- Conteúdo da Aba Linhas -->
    <div class="tab-content" id="tab-lines" style="display: block;">
      <div class="card">
        <h3 id="line-form-title">Adicionar Nova Linha</h3>
        <form id="line-form">
          <label class="label" for="line-name">Nome da Linha</label>
          <input type="text" id="line-name" class="input" placeholder="Ex: Linha Pinheirinho" required />

          <label class="label" for="line-number">Número/Código</label>
          <input type="text" id="line-number" class="input" placeholder="Ex: 350" required />

          <label class="label" for="line-color">Cor da Linha (Identificador)</label>
          <input type="color" id="line-color" class="input" value="#6366f1" style="height: 44px; padding: 4px;" required />

          <div style="display: flex; gap: 8px;">
            <button type="submit" class="btn btn-primary" style="flex: 1;" id="btn-save-line">Adicionar Linha</button>
            <button type="button" class="btn btn-secondary" id="btn-cancel-line" style="display: none;">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Linhas Cadastradas</h3>
        <div class="list-container" id="lines-list-container">
          <p style="text-align: center; padding: 12px 0;">Carregando linhas...</p>
        </div>
      </div>
    </div>

    <!-- Conteúdo da Aba Pontos -->
    <div class="tab-content" id="tab-stops" style="display: none;">
      <div class="card">
        <h3 id="stop-form-title">Adicionar Novo Ponto</h3>
        <form id="stop-form">
          <label class="label" for="stop-name">Nome do Ponto</label>
          <input type="text" id="stop-name" class="input" placeholder="Ex: Ponto da Praça Central" required />

          <div style="display: flex; gap: 8px;">
            <button type="submit" class="btn btn-primary" style="flex: 1;" id="btn-save-stop">Adicionar Ponto</button>
            <button type="button" class="btn btn-secondary" id="btn-cancel-stop" style="display: none;">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Pontos Cadastrados</h3>
        <div class="list-container" id="stops-list-container">
          <p style="text-align: center; padding: 12px 0;">Carregando pontos...</p>
        </div>
      </div>
    </div>

    <!-- Conteúdo da Aba Horários -->
    <div class="tab-content" id="tab-schedules" style="display: none;">
      <div class="card">
        <h3>Filtros de Tabela</h3>
        <label class="label" for="schedule-line-select">Selecionar Linha</label>
        <select class="select" id="schedule-line-select">
          <option value="none">Selecione uma linha...</option>
        </select>

        <label class="label" for="schedule-daytype-select">Tipo de Dia</label>
        <select class="select" id="schedule-daytype-select">
          <option value="weekday">Dias Úteis (Seg à Sex)</option>
          <option value="saturday">Sábado</option>
          <option value="sunday_holiday">Domingo e Feriados</option>
        </select>
      </div>

      <div class="card" id="schedules-editor-card" style="display: none;">
        <h3>Cadastrar Novos Horários</h3>
        <p style="margin-bottom: 12px; font-size: 13px;">Insira um horário por linha no formato HH:MM (ex: 07:15).</p>
        <form id="schedules-form">
          <textarea id="schedules-raw-text" class="input" style="height: 120px; font-family: monospace; resize: none;" placeholder="07:00&#10;07:15&#10;07:45" required></textarea>
          <button type="submit" class="btn btn-primary" style="width: 100%;">Importar Horários</button>
        </form>
      </div>

      <div class="card" id="schedules-list-card" style="display: none;">
        <h3>Horários Programados</h3>
        <div class="list-container" id="schedules-list-container">
          <!-- A lista de horários cadastrados será injetada aqui -->
        </div>
      </div>
    </div>

    <!-- Conteúdo da Aba Presets (Trajetos) -->
    <div class="tab-content" id="tab-presets" style="display: none;">
      <div class="card">
        <h3 id="preset-form-title">Adicionar Novo Trajeto</h3>
        <form id="preset-form">
          <label class="label" for="preset-name">Nome do Trajeto</label>
          <input type="text" id="preset-name" class="input" placeholder="Ex: Ir para a Escola" required />

          <label class="label">Selecionar Ícone</label>
          <div class="icon-grid">
            ${PRESET_ICONS.map(iconName => `
              <div class="icon-option ${iconName === selectedPresetIcon ? 'selected' : ''}" data-icon="${iconName}">
                ${getIcon(iconName, 18)}
              </div>
            `).join('')}
          </div>

          <label class="label" for="preset-line-select">Linha de Ônibus</label>
          <select class="select" id="preset-line-select" required>
            <option value="">Selecione uma linha...</option>
          </select>

          <label class="label" for="preset-boarding-select">Ponto de Embarque</label>
          <select class="select" id="preset-boarding-select" required>
            <option value="">Selecione o ponto de embarque...</option>
          </select>

          <label class="label" for="preset-destination-select">Ponto de Desembarque</label>
          <select class="select" id="preset-destination-select" required>
            <option value="">Selecione o ponto de desembarque...</option>
          </select>

          <label class="label" for="preset-boarding-offset">Deslocamento até o Embarque (Minutos)</label>
          <input type="number" id="preset-boarding-offset" class="input" min="0" value="5" placeholder="Tempo de caminhada até o ponto" required />

          <label class="label" for="preset-trip-duration">Duração Estimada da Viagem (Minutos)</label>
          <input type="number" id="preset-trip-duration" class="input" min="0" value="25" placeholder="Tempo de viagem no ônibus" required />

          <label class="label" for="preset-buffer-time">Margem de Segurança (Minutos de Antecedência)</label>
          <input type="number" id="preset-buffer-time" class="input" min="0" value="2" placeholder="Ex: 2 min antes da previsão da IA" required />

          <label class="label" for="preset-schedule-select">Horário de Costume (Opcional)</label>
          <select class="select" id="preset-schedule-select">
            <option value="none">Selecione uma linha primeiro...</option>
          </select>

          <div style="display: flex; gap: 8px;">
            <button type="submit" class="btn btn-primary" style="flex: 1;" id="btn-save-preset">Salvar Trajeto</button>
            <button type="button" class="btn btn-secondary" id="btn-cancel-preset" style="display: none;">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Trajetos Configurados</h3>
        <div class="list-container" id="presets-list-container">
          <p style="text-align: center; padding: 12px 0;">Carregando trajetos...</p>
        </div>
      </div>
    </div>

    <!-- Seção de Backup e Restauração de Dados -->
    <div class="card" style="margin-top: 24px; border-color: rgba(99, 102, 241, 0.3); background: linear-gradient(180deg, var(--surface) 0%, rgba(99, 102, 241, 0.02) 100%);">
      <h3>Segurança dos Dados</h3>
      <p style="margin-bottom: 12px; font-size: 13px;">Faça backup de suas linhas, horários e histórico de viagens localmente.</p>
      
      <!-- Seletores de exportação melhorada -->
      <div style="margin-bottom: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <label class="label" for="export-period" style="font-size: 9px; margin-bottom: 4px; display: block;">Período do Histórico</label>
          <select class="select" id="export-period" style="margin-bottom: 0; padding: 6px 10px; font-size: 12px; height: 34px;">
            <option value="all">Todo o histórico</option>
            <option value="30">Últimos 30 dias</option>
            <option value="7">Últimos 7 dias</option>
          </select>
        </div>
        <div>
          <label class="label" for="export-format" style="font-size: 9px; margin-bottom: 4px; display: block;">Formato do Arquivo</label>
          <select class="select" id="export-format" style="margin-bottom: 0; padding: 6px 10px; font-size: 12px; height: 34px;">
            <option value="json">Backup Completo (JSON)</option>
            <option value="report">Relatório Legível (TXT)</option>
          </select>
        </div>
      </div>
      
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-secondary" id="btn-export-backup" style="flex: 1; gap: 6px;">📥 Exportar Backup</button>
        <button class="btn btn-secondary" id="btn-trigger-import" style="flex: 1; gap: 6px;">📤 Importar Backup</button>
      </div>
      <input type="file" id="import-file-input" style="display: none;" accept=".json" />
    </div>
  `;
}

/**
 * Inicializa a escuta de eventos da página de gerenciamento.
 */
export async function initManagePage(): Promise<void> {
  setupTabs();
  setupBackupEvents();

  // Inicializa cada componente e carrega as listas do DB
  await Promise.all([
    setupLinesTab(),
    setupStopsTab(),
    setupSchedulesTab(),
    setupPresetsTab()
  ]);
}

// ============================================================
// SISTEMA DE ABAS (TABS)
// ============================================================
function setupTabs(): void {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Altera a classe ativa do botão
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Exibe a seção de conteúdo correspondente
      const target = tab.getAttribute('data-tab');
      contents.forEach(content => {
        const id = content.getAttribute('id');
        if (id === `tab-${target}`) {
          (content as HTMLElement).style.display = 'block';
        } else {
          (content as HTMLElement).style.display = 'none';
        }
      });
    });
  });
}

// ============================================================
// ABA 1: LINHAS (BUS LINES)
// ============================================================
async function setupLinesTab(): Promise<void> {
  const form = document.getElementById('line-form') as HTMLFormElement;
  const nameInput = document.getElementById('line-name') as HTMLInputElement;
  const numberInput = document.getElementById('line-number') as HTMLInputElement;
  const colorInput = document.getElementById('line-color') as HTMLInputElement;
  const cancelBtn = document.getElementById('btn-cancel-line') as HTMLButtonElement;
  const submitBtn = document.getElementById('btn-save-line') as HTMLButtonElement;
  const formTitle = document.getElementById('line-form-title') as HTMLElement;

  if (!form) return;

  // Renderiza a lista inicial
  await renderLinesList();

  // Trata cancelamento de edição
  cancelBtn.addEventListener('click', () => {
    editingLineId = null;
    form.reset();
    formTitle.textContent = 'Adicionar Nova Linha';
    submitBtn.textContent = 'Adicionar Linha';
    cancelBtn.style.display = 'none';
  });

  // Salva ou adiciona linha
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const number = numberInput.value.trim();
    const color = colorInput.value;

    if (!name || !number) {
      showToast('Por favor, preencha todos os campos obrigatórios.', 'error');
      return;
    }

    const lineData: BusLine = {
      id: editingLineId || generateId(),
      name,
      number,
      color
    };

    await put('busLines', lineData);
    
    showToast(
      editingLineId ? 'Linha de ônibus atualizada!' : 'Nova linha de ônibus adicionada!', 
      'success'
    );

    // Limpa o formulário e reseta estados
    editingLineId = null;
    form.reset();
    formTitle.textContent = 'Adicionar Nova Linha';
    submitBtn.textContent = 'Adicionar Linha';
    cancelBtn.style.display = 'none';

    // Recarrega as listas dependentes
    await Promise.all([
      renderLinesList(),
      populateSchedulesDropdowns(),
      populatePresetsDropdowns()
    ]);
  });
}

async function renderLinesList(): Promise<void> {
  const container = document.getElementById('lines-list-container');
  if (!container) return;

  const lines = await getAll<BusLine>('busLines');

  if (lines.length === 0) {
    container.innerHTML = `
      <p style="text-align: center; padding: 20px 0; color: var(--text-secondary); font-size: 13px;">
        Nenhuma linha cadastrada ainda.
      </p>
    `;
    return;
  }

  container.innerHTML = lines.map(line => `
    <div class="list-item">
      <div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="record-line-badge" style="background-color: ${line.color};">${line.number}</span>
          <span class="list-item-title">${line.name}</span>
        </div>
      </div>
      <div class="list-item-actions">
        <button class="list-item-btn edit-line-btn" data-id="${line.id}" title="Editar">${getIcon('edit', 14)}</button>
        <button class="list-item-btn delete delete-line-btn" data-id="${line.id}" title="Excluir">${getIcon('trash', 14)}</button>
      </div>
    </div>
  `).join('');

  // Adiciona listeners para os botões de editar e excluir
  container.querySelectorAll('.edit-line-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')!;
      const line = await getLineById(id);
      if (line) {
        editingLineId = line.id;
        (document.getElementById('line-name') as HTMLInputElement).value = line.name;
        (document.getElementById('line-number') as HTMLInputElement).value = line.number;
        (document.getElementById('line-color') as HTMLInputElement).value = line.color;
        
        (document.getElementById('line-form-title') as HTMLElement).textContent = 'Editar Linha';
        (document.getElementById('btn-save-line') as HTMLButtonElement).textContent = 'Salvar Alterações';
        (document.getElementById('btn-cancel-line') as HTMLButtonElement).style.display = 'block';

        // Rola até o topo do formulário
        document.getElementById('line-form')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  container.querySelectorAll('.delete-line-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')!;
      showModal(
        'Confirmar Exclusão', 
        'Deseja realmente excluir esta linha de ônibus? Todos os horários programados a ela associados também serão perdidos.',
        async () => {
          // Deleta a linha
          await remove('busLines', id);

          // Limpa horários órfãos
          const schedules = await getAll<Schedule>('schedules');
          const orphanedSchedules = schedules.filter(s => s.lineId === id);
          for (const s of orphanedSchedules) {
            await remove('schedules', s.id);
          }

          showToast('Linha de ônibus excluída com sucesso!', 'success');

          // Recarrega visualizadores
          await Promise.all([
            renderLinesList(),
            populateSchedulesDropdowns(),
            populatePresetsDropdowns()
          ]);
        }
      );
    });
  });
}

async function getLineById(id: string): Promise<BusLine | undefined> {
  const lines = await getAll<BusLine>('busLines');
  return lines.find(l => l.id === id);
}

// ============================================================
// ABA 2: PONTOS DE EMBARQUE/DESEMBARQUE (BUS STOPS)
// ============================================================
async function setupStopsTab(): Promise<void> {
  const form = document.getElementById('stop-form') as HTMLFormElement;
  const nameInput = document.getElementById('stop-name') as HTMLInputElement;
  const cancelBtn = document.getElementById('btn-cancel-stop') as HTMLButtonElement;
  const submitBtn = document.getElementById('btn-save-stop') as HTMLButtonElement;
  const formTitle = document.getElementById('stop-form-title') as HTMLElement;

  if (!form) return;

  await renderStopsList();

  cancelBtn.addEventListener('click', () => {
    editingStopId = null;
    form.reset();
    formTitle.textContent = 'Adicionar Novo Ponto';
    submitBtn.textContent = 'Adicionar Ponto';
    cancelBtn.style.display = 'none';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();

    if (!name) {
      showToast('Por favor, digite o nome do ponto.', 'error');
      return;
    }

    const stopData: BusStop = {
      id: editingStopId || generateId(),
      name
    };

    await put('busStops', stopData);
    
    showToast(
      editingStopId ? 'Ponto de ônibus atualizado!' : 'Novo ponto de ônibus adicionado!', 
      'success'
    );

    editingStopId = null;
    form.reset();
    formTitle.textContent = 'Adicionar Novo Ponto';
    submitBtn.textContent = 'Adicionar Ponto';
    cancelBtn.style.display = 'none';

    await Promise.all([
      renderStopsList(),
      populatePresetsDropdowns()
    ]);
  });
}

async function renderStopsList(): Promise<void> {
  const container = document.getElementById('stops-list-container');
  if (!container) return;

  const stops = await getAll<BusStop>('busStops');

  if (stops.length === 0) {
    container.innerHTML = `
      <p style="text-align: center; padding: 20px 0; color: var(--text-secondary); font-size: 13px;">
        Nenhum ponto cadastrado ainda.
      </p>
    `;
    return;
  }

  container.innerHTML = stops.map(stop => `
    <div class="list-item">
      <div>
        <span class="list-item-title">${stop.name}</span>
      </div>
      <div class="list-item-actions">
        <button class="list-item-btn edit-stop-btn" data-id="${stop.id}" title="Editar">${getIcon('edit', 14)}</button>
        <button class="list-item-btn delete delete-stop-btn" data-id="${stop.id}" title="Excluir">${getIcon('trash', 14)}</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.edit-stop-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')!;
      const stops = await getAll<BusStop>('busStops');
      const stop = stops.find(s => s.id === id);
      if (stop) {
        editingStopId = stop.id;
        (document.getElementById('stop-name') as HTMLInputElement).value = stop.name;
        
        (document.getElementById('stop-form-title') as HTMLElement).textContent = 'Editar Ponto';
        (document.getElementById('btn-save-stop') as HTMLButtonElement).textContent = 'Salvar Alterações';
        (document.getElementById('btn-cancel-stop') as HTMLButtonElement).style.display = 'block';

        document.getElementById('stop-form')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  container.querySelectorAll('.delete-stop-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')!;
      showModal(
        'Confirmar Exclusão',
        'Deseja mesmo excluir este ponto de ônibus? Ele poderá ser removido de trajetos salvos ativos.',
        async () => {
          await remove('busStops', id);
          showToast('Ponto de ônibus excluído!', 'success');
          
          await Promise.all([
            renderStopsList(),
            populatePresetsDropdowns()
          ]);
        }
      );
    });
  });
}

// ============================================================
// ABA 3: HORÁRIOS PROGRAMADOS (SCHEDULES)
// ============================================================
async function setupSchedulesTab(): Promise<void> {
  const lineSelect = document.getElementById('schedule-line-select') as HTMLSelectElement;
  const dayTypeSelect = document.getElementById('schedule-daytype-select') as HTMLSelectElement;
  const form = document.getElementById('schedules-form') as HTMLFormElement;
  const rawTextInput = document.getElementById('schedules-raw-text') as HTMLTextAreaElement;

  if (!lineSelect || !dayTypeSelect || !form) return;

  // Popula o dropdown inicial de linhas
  await populateSchedulesDropdowns();

  // Escuta alteração nos filtros
  const onFilterChange = async () => {
    const lineId = lineSelect.value;
    const dayType = dayTypeSelect.value as any;

    const editorCard = document.getElementById('schedules-editor-card')!;
    const listCard = document.getElementById('schedules-list-card')!;

    if (lineId === 'none') {
      editorCard.style.display = 'none';
      listCard.style.display = 'none';
      return;
    }

    editorCard.style.display = 'block';
    listCard.style.display = 'block';
    await renderSchedulesList(lineId, dayType);
  };

  lineSelect.addEventListener('change', onFilterChange);
  dayTypeSelect.addEventListener('change', onFilterChange);

  // Importação em massa de horários
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lineId = lineSelect.value;
    const dayType = dayTypeSelect.value as any;
    const rawText = rawTextInput.value;

    if (lineId === 'none') return;

    // Divide as linhas de texto, remove vazios e valida o formato HH:MM
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const timeRegex = /^\d{2}:\d{2}$/;
    
    let addedCount = 0;
    let errorCount = 0;

    for (const timeStr of lines) {
      if (timeRegex.test(timeStr)) {
        const schedule: Schedule = {
          id: generateId(),
          lineId,
          dayType,
          departureTime: timeStr
        };
        await put('schedules', schedule);
        addedCount++;
      } else {
        errorCount++;
      }
    }

    if (addedCount > 0) {
      showToast(`${addedCount} horários importados com sucesso!`, 'success');
      if (errorCount > 0) {
        showToast(`${errorCount} linhas ignoradas por formato inválido (use HH:MM).`, 'info');
      }
      rawTextInput.value = '';
      await renderSchedulesList(lineId, dayType);
    } else {
      showToast('Nenhum horário válido detectado. Use o formato HH:MM.', 'error');
    }
  });
}

async function populateSchedulesDropdowns(): Promise<void> {
  const lineSelect = document.getElementById('schedule-line-select') as HTMLSelectElement;
  if (!lineSelect) return;

  const lines = await getAll<BusLine>('busLines');
  const previousValue = lineSelect.value;

  lineSelect.innerHTML = '<option value="none">Selecione uma linha...</option>';
  lines.forEach(line => {
    const opt = document.createElement('option');
    opt.value = line.id;
    opt.textContent = `[${line.number}] ${line.name}`;
    lineSelect.appendChild(opt);
  });

  // Restaura valor selecionado anteriormente se ainda existir
  if (lines.some(l => l.id === previousValue)) {
    lineSelect.value = previousValue;
  } else {
    lineSelect.value = 'none';
    document.getElementById('schedules-editor-card')!.style.display = 'none';
    document.getElementById('schedules-list-card')!.style.display = 'none';
  }
}

async function renderSchedulesList(lineId: string, dayType: any): Promise<void> {
  const container = document.getElementById('schedules-list-container');
  if (!container) return;

  // Busca horários específicos dessa linha
  const allSchedules = await getSchedulesByLine(lineId, dayType);
  
  // Ordena os horários cronologicamente
  const sortedSchedules = allSchedules.sort((a, b) => {
    return a.departureTime.localeCompare(b.departureTime);
  });

  if (sortedSchedules.length === 0) {
    container.innerHTML = `
      <p style="text-align: center; padding: 20px 0; color: var(--text-secondary); font-size: 13px;">
        Nenhum horário cadastrado para este dia da semana.
      </p>
    `;
    return;
  }

  container.innerHTML = sortedSchedules.map(sched => `
    <div class="list-item" style="padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
      <span style="font-family: monospace; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
        ${getIcon('clock', 15)} ${sched.departureTime}
      </span>
      <div class="list-item-actions">
        <button class="list-item-btn delete delete-schedule-btn" data-id="${sched.id}" title="Excluir">${getIcon('trash', 14)}</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.delete-schedule-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')!;
      await remove('schedules', id);
      showToast('Horário excluído!', 'success');
      await renderSchedulesList(lineId, dayType);
    });
  });
}

// ============================================================
// ABA 4: PRESETS (TRAJETOS SALVOS)
// ============================================================
async function setupPresetsTab(): Promise<void> {
  const form = document.getElementById('preset-form') as HTMLFormElement;
  const nameInput = document.getElementById('preset-name') as HTMLInputElement;
  const lineSelect = document.getElementById('preset-line-select') as HTMLSelectElement;
  const boardingSelect = document.getElementById('preset-boarding-select') as HTMLSelectElement;
  const destinationSelect = document.getElementById('preset-destination-select') as HTMLSelectElement;
  const offsetInput = document.getElementById('preset-boarding-offset') as HTMLInputElement;
  const durationInput = document.getElementById('preset-trip-duration') as HTMLInputElement;
  const bufferInput = document.getElementById('preset-buffer-time') as HTMLInputElement;
  const cancelBtn = document.getElementById('btn-cancel-preset') as HTMLButtonElement;
  const submitBtn = document.getElementById('btn-save-preset') as HTMLButtonElement;
  const formTitle = document.getElementById('preset-form-title') as HTMLElement;

  if (!form) return;

  // Popula os seletores
  await populatePresetsDropdowns();
  await renderPresetsList();

  // Escuta a mudança de linha para carregar os horários daquela linha
  lineSelect.addEventListener('change', async () => {
    await populatePresetScheduleDropdown(lineSelect.value);
  });

  // Grid de ícones vetoriais
  const iconOptions = form.querySelectorAll('.icon-option');
  iconOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      iconOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedPresetIcon = opt.getAttribute('data-icon')!;
    });
  });

  cancelBtn.addEventListener('click', async () => {
    editingPresetId = null;
    form.reset();
    formTitle.textContent = 'Adicionar Novo Trajeto';
    submitBtn.textContent = 'Salvar Trajeto';
    cancelBtn.style.display = 'none';
    
    // Limpa o select de horários
    await populatePresetScheduleDropdown('');

    // Reseta ícone para a escola (school)
    iconOptions.forEach(o => o.classList.remove('selected'));
    const defaultIcon = iconOptions[0];
    if (defaultIcon) {
      defaultIcon.classList.add('selected');
      selectedPresetIcon = 'school';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const lineId = lineSelect.value;
    const boardingStopId = boardingSelect.value;
    const destinationStopId = destinationSelect.value;
    const estimatedBoardingOffset = parseInt(offsetInput.value, 10);
    const estimatedTripDuration = parseInt(durationInput.value, 10);
    const bufferTime = parseInt(bufferInput.value, 10) || 0;

    const scheduleSelect = document.getElementById('preset-schedule-select') as HTMLSelectElement;
    const preferredScheduleId = scheduleSelect && scheduleSelect.value !== 'none' ? scheduleSelect.value : undefined;

    if (!name || !lineId || !boardingStopId || !destinationStopId) {
      showToast('Por favor, preencha todos os campos do trajeto.', 'error');
      return;
    }

    if (boardingStopId === destinationStopId) {
      showToast('Os pontos de embarque e desembarque devem ser diferentes.', 'error');
      return;
    }

    const presetData: Preset = {
      id: editingPresetId || generateId(),
      name,
      icon: selectedPresetIcon,
      lineId,
      boardingStopId,
      destinationStopId,
      estimatedBoardingOffset,
      estimatedTripDuration,
      bufferTime,
      preferredScheduleId
    };

    await put('presets', presetData);
    showToast(
      editingPresetId ? 'Trajeto atualizado com sucesso!' : 'Novo trajeto configurado!', 
      'success'
    );

    // Reseta form
    editingPresetId = null;
    form.reset();
    formTitle.textContent = 'Adicionar Novo Trajeto';
    submitBtn.textContent = 'Salvar Trajeto';
    cancelBtn.style.display = 'none';

    // Limpa o select de horários
    await populatePresetScheduleDropdown('');

    // Reseta ícone selecionado visualmente
    iconOptions.forEach(o => o.classList.remove('selected'));
    const defaultIcon = iconOptions[0];
    if (defaultIcon) {
      defaultIcon.classList.add('selected');
      selectedPresetIcon = 'school';
    }

    await renderPresetsList();
  });
}

async function populatePresetScheduleDropdown(lineId: string, selectedScheduleId?: string): Promise<void> {
  const scheduleSelect = document.getElementById('preset-schedule-select') as HTMLSelectElement;
  if (!scheduleSelect) return;

  if (!lineId || lineId === 'none') {
    scheduleSelect.innerHTML = '<option value="none">Selecione uma linha primeiro...</option>';
    scheduleSelect.disabled = true;
    return;
  }

  const schedules = await getSchedulesByLine(lineId);
  const sorted = schedules.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  scheduleSelect.disabled = false;
  scheduleSelect.innerHTML = '<option value="none">Nenhum (usar próximo horário dinâmico)</option>';

  const dayTypeLabels: Record<string, string> = {
    weekday: 'Útil',
    saturday: 'Sáb',
    sunday_holiday: 'Dom/Feriado'
  };

  sorted.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.departureTime} (${dayTypeLabels[s.dayType] || s.dayType})`;
    if (selectedScheduleId && s.id === selectedScheduleId) {
      opt.selected = true;
    }
    scheduleSelect.appendChild(opt);
  });
}

async function populatePresetsDropdowns(): Promise<void> {
  const lineSelect = document.getElementById('preset-line-select') as HTMLSelectElement;
  const boardingSelect = document.getElementById('preset-boarding-select') as HTMLSelectElement;
  const destinationSelect = document.getElementById('preset-destination-select') as HTMLSelectElement;

  if (!lineSelect || !boardingSelect || !destinationSelect) return;

  const [lines, stops] = await Promise.all([
    getAll<BusLine>('busLines'),
    getAll<BusStop>('busStops')
  ]);

  // Popula linhas
  const prevLine = lineSelect.value;
  lineSelect.innerHTML = '<option value="">Selecione uma linha...</option>';
  lines.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = `[${l.number}] ${l.name}`;
    lineSelect.appendChild(opt);
  });
  if (lines.some(l => l.id === prevLine)) {
    lineSelect.value = prevLine;
  }

  // Popula horários baseados na linha selecionada
  await populatePresetScheduleDropdown(lineSelect.value);

  // Popula pontos embarque
  const prevBoarding = boardingSelect.value;
  boardingSelect.innerHTML = '<option value="">Selecione o ponto de embarque...</option>';
  stops.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    boardingSelect.appendChild(opt);
  });
  if (stops.some(s => s.id === prevBoarding)) boardingSelect.value = prevBoarding;

  // Popula pontos destino
  const prevDest = destinationSelect.value;
  destinationSelect.innerHTML = '<option value="">Selecione o ponto de desembarque...</option>';
  stops.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    destinationSelect.appendChild(opt);
  });
  if (stops.some(s => s.id === prevDest)) destinationSelect.value = prevDest;
}

async function renderPresetsList(): Promise<void> {
  const container = document.getElementById('presets-list-container');
  if (!container) return;

  const [presets, lines, stops, schedules] = await Promise.all([
    getAll<Preset>('presets'),
    getAll<BusLine>('busLines'),
    getAll<BusStop>('busStops'),
    getAll<Schedule>('schedules')
  ]);

  if (presets.length === 0) {
    container.innerHTML = `
      <p style="text-align: center; padding: 20px 0; color: var(--text-secondary); font-size: 13px;">
        Nenhum trajeto configurado ainda.
      </p>
    `;
    return;
  }

  container.innerHTML = presets.map(preset => {
    const line = lines.find(l => l.id === preset.lineId);
    const boarding = stops.find(s => s.id === preset.boardingStopId);
    const destination = stops.find(s => s.id === preset.destinationStopId);

    const lineName = line ? `[${line.number}] ${line.name}` : 'Linha apagada';
    const routeText = boarding && destination 
      ? `${boarding.name} ${getIcon('arrowRight', 11)} ${destination.name}` 
      : 'Pontos não identificados';

    const presetIconSvg = getIcon(preset.icon, 24, 'preset-list-icon');
    const editIconSvg = getIcon('edit', 14);
    const trashIconSvg = getIcon('trash', 14);

    const preferredSchedule = schedules.find(s => s.id === preset.preferredScheduleId);
    const scheduleInfo = preferredSchedule ? ` | Costume: ${preferredSchedule.departureTime}` : '';
    const bufferInfo = (preset.bufferTime ? ` | Margem: ${preset.bufferTime} min` : '') + scheduleInfo;

    return `
      <div class="list-item" style="align-items: flex-start; padding: 12px;">
        <div style="display: flex; gap: 10px;">
          <span style="color: var(--accent); display: flex; align-items: center; justify-content: center; height: 32px;">${presetIconSvg}</span>
          <div>
            <span class="list-item-title" style="display: block; font-weight: 700;">${preset.name}</span>
            <span class="list-item-meta" style="display: block;">Linha: ${lineName}</span>
            <span class="list-item-meta" style="display: block; font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
              ${routeText}${bufferInfo}
            </span>
          </div>
        </div>
        <div class="list-item-actions">
          <button class="list-item-btn edit-preset-btn" data-id="${preset.id}" title="Editar">${editIconSvg}</button>
          <button class="list-item-btn delete delete-preset-btn" data-id="${preset.id}" title="Excluir">${trashIconSvg}</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.edit-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')!;
      const presets = await getAll<Preset>('presets');
      const preset = presets.find(p => p.id === id);
      if (preset) {
        editingPresetId = preset.id;
        (document.getElementById('preset-name') as HTMLInputElement).value = preset.name;
        (document.getElementById('preset-line-select') as HTMLSelectElement).value = preset.lineId;
        (document.getElementById('preset-boarding-select') as HTMLSelectElement).value = preset.boardingStopId;
        (document.getElementById('preset-destination-select') as HTMLSelectElement).value = preset.destinationStopId;
        (document.getElementById('preset-boarding-offset') as HTMLInputElement).value = preset.estimatedBoardingOffset.toString();
        (document.getElementById('preset-trip-duration') as HTMLInputElement).value = preset.estimatedTripDuration.toString();
        (document.getElementById('preset-buffer-time') as HTMLInputElement).value = (preset.bufferTime ?? 0).toString();

        // Carrega o dropdown de horários de costume com a linha do preset e seleciona o correto
        await populatePresetScheduleDropdown(preset.lineId, preset.preferredScheduleId);

        // Altera ícone ativo na grid
        const iconOptions = document.querySelectorAll('#tab-presets .icon-option');
        iconOptions.forEach(opt => {
          if (opt.getAttribute('data-icon') === preset.icon) {
            opt.classList.add('selected');
            selectedPresetIcon = preset.icon;
          } else {
            opt.classList.remove('selected');
          }
        });

        (document.getElementById('preset-form-title') as HTMLElement).textContent = 'Editar Trajeto';
        (document.getElementById('btn-save-preset') as HTMLButtonElement).textContent = 'Salvar Alterações';
        (document.getElementById('btn-cancel-preset') as HTMLButtonElement).style.display = 'block';

        document.getElementById('preset-form')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  container.querySelectorAll('.delete-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')!;
      showModal(
        'Confirmar Exclusão',
        'Deseja mesmo excluir este trajeto?',
        async () => {
          await remove('presets', id);
          
          // Se for o preset ativo configurado nas opções gerais, limpa-o
          const settings = await getSettings();
          if (settings.activePresetId === id) {
            await saveSettings({ activePresetId: null });
          }

          showToast('Trajeto excluído com sucesso!', 'success');
          await renderPresetsList();
        }
      );
    });
  });
}

// ============================================================
// BACKUP E RESTAURAÇÃO DE DADOS
// ============================================================
function setupBackupEvents(): void {
  const btnExport = document.getElementById('btn-export-backup') as HTMLButtonElement;
  const btnTriggerImport = document.getElementById('btn-trigger-import') as HTMLButtonElement;
  const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
  const selectPeriod = document.getElementById('export-period') as HTMLSelectElement;
  const selectFormat = document.getElementById('export-format') as HTMLSelectElement;

  if (!btnExport || !btnTriggerImport || !fileInput) return;

  // Exportar dados
  btnExport.addEventListener('click', async () => {
    try {
      const period = selectPeriod ? selectPeriod.value : 'all';
      const format = selectFormat ? selectFormat.value : 'json';
      await exportBackup(period, format);
      showToast(format === 'json' ? 'Backup gerado com sucesso!' : 'Relatório gerado com sucesso!', 'success');
    } catch (err) {
      showToast('Falha ao exportar os dados.', 'error');
    }
  });

  // Clique simulado do input file
  btnTriggerImport.addEventListener('click', () => {
    fileInput.click();
  });

  // Importar dados após seleção de arquivo
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];

    showModal(
      'Confirmar Restauração',
      'Importar este arquivo substituirá TODO o seu banco de dados atual do BoraBus. Deseja continuar?',
      async () => {
        try {
          const res = await importBackup(file);
          if (res.success) {
            showToast('Dados restaurados com sucesso!', 'success');
            // Recarrega a página após 1.5s para aplicar todas as tabelas importadas
            setTimeout(() => {
              window.location.reload();
            }, 1500);
          } else {
            showToast(`Falha na importação: ${res.message}`, 'error');
          }
        } catch (err) {
          showToast('Arquivo de backup inválido.', 'error');
        }
        // Reseta o input para permitir novas seleções
        fileInput.value = '';
      }
    );
  });
}
