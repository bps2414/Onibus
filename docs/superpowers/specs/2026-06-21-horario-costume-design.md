# Design Spec — Horário de Costume no Trajeto (Preset)

## 1. Objetivos
* Permitir configurar um "Horário de Costume" preferencial (Schedule) associado a cada trajeto (Preset).
* Focar a previsão de IA da tela inicial Home nesse horário fixado, em vez de pular para o próximo ônibus da tabela caso o horário configurado atrase um pouco.
* Manter total retrocompatibilidade e migração transparente de dados para presets antigos ou backups importados sem esse campo.

---

## 2. Arquitetura de Previsão Dinâmica vs. Fixa

```mermaid
graph TD
    A[Inicia home.ts] --> B{Tem preferredScheduleId?}
    B -->|Não ou "none"| C[Comportamento Atual: busca primeiro ônibus futuro]
    B -->|Sim| D{Horário cadastrado existe para o dia de hoje?}
    D -->|Sim| E[Exibe previsão fixa do horário de costume]
    D -->|Não| C
```

---

## 3. Componentes e Mudanças Propostas

### 3.1 Modelo de Dados (`src/types.ts`)
* Adicionar a propriedade opcional `preferredScheduleId?: string` na interface `Preset`.

### 3.2 Gerenciador de Trajetos (`src/pages/manage.ts`)
* **HTML do Formulário:** Adicionar um campo `<select id="preset-schedule-select">` para "Horário de Costume (Opcional)".
* **População Dinâmica:** Criar a função helper `populatePresetScheduleDropdown(lineId, selectedScheduleId)` que busca e popula o seletor apenas com os horários da linha selecionada.
* **Eventos do Form:**
  * Escutar mudanças no seletor de linha de ônibus para atualizar o dropdown de horários correspondentes.
  * Capturar e persistir `preferredScheduleId` ao salvar o preset (atribuindo `undefined` caso seja `'none'`).
  * Atualizar o dropdown de horários ao carregar um preset para edição.
  * Resetar o dropdown ao cancelar ou limpar o formulário.
* **Exibição na Lista:** Exibir o horário de costume configurado no meta-texto do card do trajeto (ex: `Costume: 06:00`).

### 3.3 Tela Principal (`src/pages/home.ts`)
* **Fluxo da Previsão (`updateTrackerView`):**
  * Verificar se o preset ativo possui `preferredScheduleId`.
  * Se configurado e aplicável para o tipo de dia atual, chamar o motor de previsão `predictArrival()` para esse horário fixado.
  * Caso contrário, cair no comportamento dinâmico tradicional (`findNextBuses()`).

---

## 4. Plano de Verificação e Migração

### Migração de Dados
* Como o IndexedDB armazena JSON livre, presets antigos não apresentarão a chave `preferredScheduleId`. Ao lê-los, o valor será `undefined`. A lógica tratará `undefined` exatamente como `'none'`, mantendo o comportamento dinâmico anterior sem erros de quebra de esquema.

### Testes Manuais
1. **Configuração do Trajeto:** Criar um novo trajeto e fixar um horário de costume. Salvar e editar para confirmar que o horário configurado permanece selecionado.
2. **Previsão Travada:** Configurar um trajeto com costume de 06:00. Abrir a Home às 06:05. Verificar se a previsão exibida ainda é a do ônibus de 06:00 (marcando-o como atrasado), em vez de pular para o de 06:30.
3. **Compatibilidade de Backup:** Fazer download do backup de dados, limpar o IndexedDB, restaurar o backup e confirmar que o app continua inicializando perfeitamente sem falhas.
