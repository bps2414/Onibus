const fs = require('fs');
const path = require('path');

// Caminho do backup
const backupPath = path.join(__dirname, 'bustracker-backup-2026-06-20.json');
const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

console.log('Lendo backup existente...');
console.log(`Linhas: ${data.busLines.length}, Horários: ${data.schedules.length}, Presets: ${data.presets.length}`);

// Helper para gerar UUIDs simples
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 1. Adicionar Schedules de Sábado para a linha Curuzu x Itaboraí (be14dbc7-89d3-4a6e-936c-5eebe89d76af)
const curuzuSatTimes = [
  '05:00', '06:00', '07:00', '07:40', '08:20', '09:00', '09:40', '10:20', '11:00', '11:40', 
  '12:20', '13:00', '13:40', '14:20', '15:00', '15:40', '16:20', '17:00', '17:40', '18:20', 
  '19:00', '19:40', '20:20', '21:00', '21:40', '22:00', '22:40', '23:20'
];

curuzuSatTimes.forEach(time => {
  // Verifica se já não existe
  const exists = data.schedules.some(s => s.lineId === 'be14dbc7-89d3-4a6e-936c-5eebe89d76af' && s.dayType === 'saturday' && s.departureTime === time);
  if (!exists) {
    data.schedules.push({
      id: uuid(),
      lineId: 'be14dbc7-89d3-4a6e-936c-5eebe89d76af',
      dayType: 'saturday',
      departureTime: time
    });
  }
});

// 2. Adicionar Schedules de Sábado para a linha Itaboraí x Curuzu (4e19c0fa-c70a-477e-8c5e-2578314d4cbb)
const itaboraiSatTimes = [
  '04:10', '05:00', '06:00', '06:40', '07:20', '08:00', '08:40', '09:20', '10:00', '10:40', 
  '11:20', '12:00', '12:40', '13:20', '14:00', '14:40', '15:20', '16:00', '16:40', '17:20', 
  '18:00', '18:40', '19:20', '20:00', '20:40', '21:20', '22:00', '22:40'
];

itaboraiSatTimes.forEach(time => {
  const exists = data.schedules.some(s => s.lineId === '4e19c0fa-c70a-477e-8c5e-2578314d4cbb' && s.dayType === 'saturday' && s.departureTime === time);
  if (!exists) {
    data.schedules.push({
      id: uuid(),
      lineId: '4e19c0fa-c70a-477e-8c5e-2578314d4cbb',
      dayType: 'saturday',
      departureTime: time
    });
  }
});

// 3. Adicionar Schedules de Sábado para as linhas 701
const fagundesSatTimes = [
  '05:50', '08:00', '08:30', '11:30', '15:45', '17:25', '19:19', '20:45'
];
fagundesSatTimes.forEach(time => {
  const exists = data.schedules.some(s => s.lineId === '1ddec25f-41d8-49c6-b4fa-a2ce1d82fb19' && s.dayType === 'saturday' && s.departureTime === time);
  if (!exists) {
    data.schedules.push({
      id: uuid(),
      lineId: '1ddec25f-41d8-49c6-b4fa-a2ce1d82fb19',
      dayType: 'saturday',
      departureTime: time
    });
  }
});

// Helper para somar minutos a uma string HH:MM
function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// 4. Gerar registros de viagens (tripRecords) nas últimas 4 semanas
const tripRecords = [];

// Hoje é 2026-06-20 (Sábado)
const baseDate = new Date(2026, 5, 20); // 20 Junho 2026

for (let i = 28; i >= 1; i--) {
  const targetDate = new Date(baseDate);
  targetDate.setDate(baseDate.getDate() - i);
  
  const dateStr = targetDate.toISOString().split('T')[0];
  const dayOfWeek = targetDate.getDay();
  
  let dayType = 'weekday';
  if (dayOfWeek === 0) dayType = 'sunday_holiday';
  else if (dayOfWeek === 6) dayType = 'saturday';

  // Gerar viagens para Dias Úteis
  if (dayType === 'weekday') {
    // ----------------------------------------------------
    // Preset "Ir pro Centro/Escola" (42dd91fb-9c41-4238-a640-f1a94cc581b1)
    // Usando ônibus das 07:00. Estimativa: offset 30, viagem 25
    // ----------------------------------------------------
    const offset = Math.round(27 + Math.random() * 8); 
    const busArrived = addMinutes('07:00', offset);
    const tripDuration = Math.round(21 + Math.random() * 7);
    const arrivedDest = addMinutes(busArrived, tripDuration);

    tripRecords.push({
      id: uuid(),
      presetId: '42dd91fb-9c41-4238-a640-f1a94cc581b1',
      date: dateStr,
      dayOfWeek,
      dayType,
      scheduledDeparture: '07:00',
      busArrivedAt: busArrived,
      arrivedAtDestination: arrivedDest
    });

    // ----------------------------------------------------
    // Preset "Ir pra casa (Laranjinha)" (0325184e-15f0-441c-b20b-1e441f9245c8)
    // Usando ônibus das 17:20. Estimativa: offset 2, viagem 22
    // ----------------------------------------------------
    const offsetHome = Math.round(1 + Math.random() * 4); 
    const busArrivedHome = addMinutes('17:20', offsetHome);
    const tripDurationHome = Math.round(19 + Math.random() * 6); 
    const arrivedDestHome = addMinutes(busArrivedHome, tripDurationHome);

    tripRecords.push({
      id: uuid(),
      presetId: '0325184e-15f0-441c-b20b-1e441f9245c8',
      date: dateStr,
      dayOfWeek,
      dayType,
      scheduledDeparture: '17:20',
      busArrivedAt: busArrivedHome,
      arrivedAtDestination: arrivedDestHome
    });
  }
  
  // Gerar viagens para Sábado
  if (dayType === 'saturday') {
    const offset = Math.round(28 + Math.random() * 6); 
    const busArrived = addMinutes('09:00', offset);
    const tripDuration = Math.round(22 + Math.random() * 5); 
    const arrivedDest = addMinutes(busArrived, tripDuration);

    tripRecords.push({
      id: uuid(),
      presetId: '42dd91fb-9c41-4238-a640-f1a94cc581b1',
      date: dateStr,
      dayOfWeek,
      dayType,
      scheduledDeparture: '09:00',
      busArrivedAt: busArrived,
      arrivedAtDestination: arrivedDest
    });
  }
}

data.tripRecords = tripRecords;
console.log(`Gerados ${tripRecords.length} registros de viagens fictícias.`);

fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
console.log('Backup atualizado com sucesso!');
