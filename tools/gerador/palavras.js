// Listas de palavras: frequência (mais comuns primeiro) filtrada pelo dicionário.
// As listas não ficam no repositório (têm licenças próprias); são baixadas por URL.

export const URL_FREQUENCIA = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_50k.txt';
export const URL_DICIONARIO = 'https://raw.githubusercontent.com/pythonprobr/palavras/master/palavras.txt';

// Palavras curtas aceitas. Na lista de frequência (legendas de filmes) as palavras
// de 2 e 3 letras vêm cheias de siglas, inglês e nomes; por isso só entram estas,
// escolhidas uma a uma. Acrescente aqui se faltar alguma boa.
const DUAS_LETRAS = new Set('AR FE PE JA LA CA DO DA NO NA OS AS UM EM OU EU TU ME TE SE OI AI PO PA NU MA RE SI LE VE VI RI LI DE NE GO OH'.split(' '));
const TRES_LETRAS = new Set((
  'QUE NAO UMA COM POR ELE MAS BEM ELA SIM TEM MEU SEU VAI SER SEI NOS ERA BOM TER SAO MIM ATE VER TAO DOS SEM ' +
  'DIA PAI MAE VEZ NEM BOA FAZ DAS DAR LHE VAO OLA DIZ VEM NAS MAL AMO ANO FOR ALI NUM VIR FIM MAO TAL IRA MIL ' +
  'PAZ SOB LUZ VIM REI ALO AMA RUA TIO DOR VOZ DAI SAI TOM DEZ SOL LEI CEU MES DEI LER BAR MAR MAU TEU PES TIA ' +
  'CHA SUL RIO TUA ORA UAU LUA CAO SOM COR PAR AVO LAR CAI DOI RIR PAO VIA GAS MEL ATO PAU VOO CEM DOM SAL FIO ' +
  'SOS OVO EVA ACO LAS VOS NUA REU ALA PUS CLA EGO CAL VOA AVE PIA RIM GOL ASA TOA SPA RUM FAX VEU BAU ELO ECO ' +
  'CRU BOI UVA VIL GIZ GIM GEL POS PIO PAS OCA NOZ IMA TAU CIO EPA ZOO RAS ABC OLE PSI OCO ARO ANU SOR ETA TIL ' +
  'HUM DAO JUS ZEN NUS ROI POE VAS RES SUA ' +
  'ABA ATA BIS DUO EMA FEL FOZ NAU ODE ROL TEZ UFA VAU XIS PUA MOI LIA SOA RIA ' +
  'SOU DOU VOU FUI FOI DEU LEU VIU RIU'
).split(' '));

// Palavras "de revista" (bichos, plantas, objetos, termos), com definição clara,
// que a lista de legendas quase não traz. Entram na lista base na posição
// POSICAO_EXTRAS (todas os níveis as alcançam). Precisam estar no dicionário.
const EXTRAS = (
  'ARE ARA OBA CAS GNU AIO UPA URU MI FA ' +
  'ANTA ATOL ANIL ALHO ARCO ASNO BAGO BOTO CAJU COCO COXA CUCO DUNA EGUA FAVO FOCA GALO GAMO ' +
  'GOMO ILHA JACA JUBA LAGO LAMA LIRA LOBO MAGO MICO MOLA NABO OBOE OLMO ONCA ORCA OSSO OVAS ' +
  'PATO PERA PIPA PUMA ROCA RUBI SAPO SEDA SOJA TATU TEIA TUBA URSO URNA VASO VELA ZEBU ARARA ' +
  'GRUTA LONTRA TUCANO JIBOIA CORUJA GIRAFA CAMELO ESQUILO PINGUIM GOLFINHO CANGURU ' +
  'ABACATE ABACAXI AMEIXA CEREJA GOIABA MAMAO MARACUJA PITANGA JABUTICABA ' +
  'BIGORNA BUSSOLA CANIVETE CATAVENTO AMPULHETA LUNETA TROMBONE SANFONA BERIMBAU PANDEIRO ' +
  'CAVAQUINHO ATABAQUE ORQUIDEA GIRASSOL BROMELIA SAMAMBAIA CACTO BAOBA IPE JEQUITIBA'
).split(' ');
const POSICAO_EXTRAS = 3000;

// Nomes próprios conhecidos (países, capitais, rios, estados, personagens,
// figuras históricas), para dicas de conhecimento geral como nas revistas.
// Entram mais para o fim da lista (POSICAO_NOMES) e cada cruzada aceita poucos
// (variedade.js). Sem times, marcas nem pessoas vivas.
export const NOMES = new Set((
  'PERU CUBA CHILE CHINA JAPAO ITALIA FRANCA EGITO GRECIA MEXICO CANADA NEPAL QUENIA ANGOLA HAITI ' +
  'INDIA SUICA SUECIA NORUEGA HOLANDA BELGICA POLONIA PORTUGAL ESPANHA MARROCOS TURQUIA BOLIVIA ' +
  'URUGUAI PARAGUAI COLOMBIA EQUADOR PANAMA IRLANDA ESCOCIA ISLANDIA ETIOPIA SENEGAL TUNISIA CHIPRE MALTA TAITI ' +
  'ROMA PARIS LIMA OSLO LONDRES MADRI LISBOA BERLIM VIENA ATENAS CAIRO TOQUIO PEQUIM DUBLIN PRAGA ' +
  'QUITO BOGOTA CARACAS HAVANA SANTIAGO LUANDA DACAR NAIROBI BERNA ANCARA SEUL HANOI MANILA ' +
  'BAHIA GOIAS ACRE AMAPA CEARA PIAUI SERGIPE ALAGOAS RORAIMA MARANHAO RECIFE BELEM MANAUS MACEIO ' +
  'ARACAJU CUIABA CURITIBA GOIANIA TERESINA OLINDA ' +
  'NILO AMAZONAS TIETE SENA TAMISA DANUBIO RENO VOLGA GANGES JORDAO TEJO DOURO XINGU TAPAJOS ARAGUAIA ' +
  'PERI IRACEMA CAPITU MACUNAIMA EMILIA PEDRINHO SACI CURUPIRA IARA BOITATA QUIXOTE HAMLET ROMEU ' +
  'JULIETA ULISSES AQUILES HERCULES ZEUS APOLO ATENA NETUNO PLUTAO JUPITER SATURNO VENUS ODIN THOR ' +
  'PELE GARRINCHA SENNA TIRADENTES CABRAL DARWIN NEWTON EINSTEIN MOZART BACH BEETHOVEN PICASSO DALI ' +
  'GOYA MONET DANTE CAMOES DRUMMOND PORTINARI TARSILA NIEMEYER GANDHI DUMONT CHAPLIN PLATAO SOCRATES ' +
  'HOMERO COLOMBO GALILEU EDISON TESLA'
).split(' '));
const POSICAO_NOMES = 6000;

// Terminações de formas verbais conjugadas que não se confundem com substantivo
// (andava, falaram, comendo, partiu...), por infinitivo. Essas formas quase não
// têm definição e puxam dica de completar ("___"); vão para o fim da fila.
// Particípios (-ADO, -IDO) ficam de fora: valem como adjetivo.
const TERMINACOES = {
  AR: 'ANDO AVA AVAM AVAS AVAMOS ARAM ASSE ASSEM ASSES AREI ARIA ARIAM ARAO AREMOS AMOS ASTE OU EI AM ARMOS AREM',
  ER: 'ENDO IA IAM IAS ERAM ESSE ESSEM EREI ERIA ERIAM ERAO EMOS ESTE EU EM ERMOS EREM',
  IR: 'INDO IA IAM IRAM ISSE ISSEM IREI IRIA IRAO IMOS ISTE IU EM IRMOS IREM',
};

// Numerais e ordinais: aparecem demais e puxam dicas repetitivas ("depois do
// sétimo"). Ficam fora das cruzadas.
export const CORINGAS = new Set((
  'DOIS DUAS TRES QUATRO CINCO SEIS SETE OITO NOVE DEZ ONZE DOZE TREZE CATORZE QUINZE ' +
  'VINTE TRINTA CEM MIL PRIMEIRO PRIMEIRA SEGUNDO SEGUNDA TERCEIRO TERCEIRA QUARTO QUARTA ' +
  'QUINTO QUINTA SEXTO SEXTA SETIMO SETIMA OITAVO OITAVA NONO NONA DECIMO DECIMA DEZENA DUZIA ' +
  'QUATORZE DEZESSEIS DEZESSETE DEZOITO DEZENOVE QUARENTA CINQUENTA SESSENTA SETENTA OITENTA NOVENTA ' +
  'DUZENTOS TREZENTOS QUINHENTOS CENTENA MILHAR MILHAO MILHOES BILHAO'
).split(' '));

/** Tira acentos e põe em maiúsculas: "ação" -> "ACAO". */
export const normalizar = p => p.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

/**
 * Monta a lista base, da mais comum para a menos comum.
 *  - textoFrequencia: linhas "palavra contagem";
 *  - textoDicionario: uma palavra por linha (só as em minúscula contam: as
 *    com maiúscula são nomes próprios);
 *  - proibidas: Set de palavras já normalizadas.
 */
export function montarLista(textoFrequencia, textoDicionario, proibidas, maxLetras = 11) {
  const dicionario = new Set(textoDicionario.split(/\r?\n/).filter(p => p && p === p.toLowerCase()));
  const vistas = new Set();
  const lista = [];
  for (const linha of textoFrequencia.split(/\r?\n/)) {
    const palavra = linha.split(' ')[0];
    if (!palavra || !dicionario.has(palavra)) continue;
    const p = normalizar(palavra);
    if (p.length < 2 || p.length > maxLetras || !/^[A-Z]+$/.test(p)) continue;
    if (vistas.has(p) || proibidas.has(p)) continue;
    if (p.length === 2 && !DUAS_LETRAS.has(p)) continue;
    if (p.length === 3 && !TRES_LETRAS.has(p)) continue;
    vistas.add(p);
    lista.push(p);
  }
  // palavras de revista e nomes próprios, cada grupo na sua posição
  // (as que já estão na lista, mas mais para o fim, sobem para essa posição)
  const semAcento = new Set([...dicionario].map(normalizar)); // "onça" -> ONCA
  const extras = EXTRAS.filter(p => p.length <= maxLetras && !proibidas.has(p) && semAcento.has(p) &&
    !(vistas.has(p) && lista.indexOf(p) < POSICAO_EXTRAS));
  const subir = new Set(extras);
  for (let i = lista.length - 1; i >= 0; i--) if (subir.has(lista[i])) lista.splice(i, 1);
  extras.forEach(p => vistas.add(p));
  lista.splice(Math.min(POSICAO_EXTRAS, lista.length), 0, ...extras);
  const nomes = [...NOMES].filter(p => p.length <= maxLetras && !vistas.has(p));
  lista.splice(Math.min(POSICAO_NOMES, lista.length), 0, ...nomes);
  return lista;
}

/**
 * Formas verbais conjugadas da lista (4+ letras): terminação de TERMINACOES cujo
 * radical + AR/ER/IR está no dicionário (ANDO -> ANDAR; COMIA -> COMER).
 */
export function formasVerbais(lista, textoDicionario) {
  const dicionario = new Set(textoDicionario.split(/\r?\n/).filter(p => p && p === p.toLowerCase()).map(normalizar));
  const verbais = new Set();
  for (const p of lista) {
    if (p.length < 4 || NOMES.has(p)) continue;
    for (const [infinitivo, lista] of Object.entries(TERMINACOES)) {
      if (lista.split(' ').some(t => p.endsWith(t) && p.length - t.length >= 2 && dicionario.has(p.slice(0, -t.length) + infinitivo))) {
        verbais.add(p);
        break;
      }
    }
  }
  return verbais;
}

/** Lê tools/proibidas.txt: uma palavra por linha; # começa comentário. */
export function lerProibidas(texto) {
  return new Set(texto.split(/\r?\n/)
    .map(l => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .flatMap(l => l.split(/\s+/))
    .map(normalizar));
}
