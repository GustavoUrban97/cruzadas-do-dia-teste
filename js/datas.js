// Datas sempre no horário de Brasília. Nunca usar a data UTC.

const FUSO = 'America/Sao_Paulo';

const formatoISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** "Hoje" em Brasília no formato AAAA-MM-DD. */
export function hojeEmBrasilia(agora = new Date()) {
  return formatoISO.format(agora);
}

/** Confere se o texto é uma data AAAA-MM-DD que existe no calendário. */
export function dataValida(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = paraDataUTC(iso);
  return d.toISOString().slice(0, 10) === iso;
}

// Meio-dia UTC: evita qualquer escorregão de fuso nas contas com dias.
function paraDataUTC(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12));
}

/** Soma (ou subtrai) dias a uma data AAAA-MM-DD. */
export function somarDias(iso, n) {
  const d = paraDataUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Número de dias de `de` até `ate` (pode ser negativo). */
export function diasEntre(de, ate) {
  return Math.round((paraDataUTC(ate) - paraDataUTC(de)) / 86400000);
}

const formatoExtenso = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

/** "domingo, 15 de novembro de 2026" */
export function dataPorExtenso(iso) {
  return formatoExtenso.format(paraDataUTC(iso));
}

/** "07/11" */
export function dataCurta(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

const formatoSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });

/** "sáb, 07/11" (cabeçalho do celular) */
export function dataAbreviada(iso) {
  return `${formatoSemana.format(paraDataUTC(iso)).replace('.', '')}, ${dataCurta(iso)}`;
}
