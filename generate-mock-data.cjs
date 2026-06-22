const fs = require('fs');
const path = require('path');

// Caminho do backup
const backupPath = path.join(__dirname, 'bustracker-backup-2026-06-20.json');
const outputPath = path.join(__dirname, 'bustracker-backup-2026-06-22-mock.json');
const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

console.log('Lendo backup existente...');
console.log(`Linhas: ${data.busLines.length}, Horários: ${data.schedules.length}, Presets: ${data.presets.length}`);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

const tripRecords = [];

// Hoje é 2026-06-22 (Segunda-feira)
const baseDate = new Date(2026, 5, 22); // 22 Junho 2026

// Vamos gerar 90 dias de histórico para dar dados suficientes para estatísticas
for (let i = 90; i >= 0; i--) {
  const targetDate = new Date(baseDate);
  targetDate.setDate(baseDate.getDate() - i);
  
  const dateStr = targetDate.toISOString().split('T')[0];
  const dayOfWeek = targetDate.getDay();
  
  let dayType = 'weekday';
  if (dayOfWeek === 0) dayType = 'sunday_holiday';
  else if (dayOfWeek === 6) dayType = 'saturday';

  if (dayType === 'weekday') {
    // ----------------------------------------------------
    // Preset "Ir pro Centro/Escola" (42dd91fb-9c41-4238-a640-f1a94cc581b1)
    // Usando ônibus das 07:00. Estimativa: offset 30, viagem 25
    // ----------------------------------------------------
    // Para ter variação interessante (ex: segunda atrasa mais)
    let delayFactor = dayOfWeek === 1 ? 5 : 0; // Segunda-feira +5 mins de atraso
    const offset = Math.round(25 + delayFactor + Math.random() * 10); 
    const busArrived = addMinutes('07:00', offset);
    const tripDuration = Math.round(20 + Math.random() * 10);
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
    let delayFactorHome = dayOfWeek === 5 ? 10 : 0; // Sexta-feira +10 mins de atraso
    const offsetHome = Math.round(delayFactorHome + Math.random() * 5); 
    const busArrivedHome = addMinutes('17:20', offsetHome);
    const tripDurationHome = Math.round(18 + Math.random() * 8); 
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

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
console.log('Backup atualizado com sucesso em ' + outputPath);
