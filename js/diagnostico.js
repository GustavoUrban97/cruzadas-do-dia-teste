// Tela de diagnóstico (?debug=1): mostra os eventos de ponteiro que o tablet envia,
// para descobrir como a S Pen (ponta, botão lateral, borracha) e a palma chegam no Chrome.

const MAX_LINHAS = 14;

export function iniciarDiagnostico(versao) {
  const painel = document.createElement('div');
  painel.className = 'diagnostico';
  const limpar = document.createElement('button');
  limpar.textContent = 'limpar';
  const texto = document.createElement('div');
  painel.append(limpar, texto);
  document.body.append(painel);

  let linhas = [];
  let linhaMovimento = '';
  let movimentos = 0;
  let coalescidos = 0;
  let inicioTaxa = performance.now();
  let taxa = 0;

  const formatar = (tipo, e) => {
    const p = e.pressure !== undefined ? e.pressure.toFixed(2) : '-';
    return `${tipo.padEnd(6)} ${String(e.pointerType).padEnd(5)} id=${e.pointerId}`
      + ` button=${e.button} buttons=${e.buttons} p=${p}`
      + ` tilt=${e.tiltX ?? 0}/${e.tiltY ?? 0} tam=${Math.round(e.width)}×${Math.round(e.height)}`;
  };

  const mostrar = () => {
    const canvas = document.querySelector('canvas.tinta');
    texto.textContent = [
      `v${versao} · tinta ${canvas ? `${canvas.width}×${canvas.height}` : 'ausente'} · dpr ${devicePixelRatio}`,
      `S Pen: ponta, botão lateral e borracha · palma deve aparecer como "touch"`,
      `movimentos/s ≈ ${taxa}  (pontos coalescidos no último: ${coalescidos})`,
      linhaMovimento,
      '—',
      ...linhas,
    ].join('\n');
  };

  const registrar = (tipo, e) => {
    linhas.unshift(formatar(tipo, e));
    linhas = linhas.slice(0, MAX_LINHAS);
    mostrar();
  };

  limpar.addEventListener('click', () => { linhas = []; mostrar(); });

  const opcoes = { capture: true, passive: true };
  window.addEventListener('pointerdown', e => registrar('down', e), opcoes);
  window.addEventListener('pointerup', e => registrar('up', e), opcoes);
  window.addEventListener('pointercancel', e => registrar('cancel', e), opcoes);
  window.addEventListener('contextmenu', e => registrar('menu', e), opcoes);
  window.addEventListener('pointermove', e => {
    movimentos++;
    coalescidos = e.getCoalescedEvents ? e.getCoalescedEvents().length : 1;
    linhaMovimento = formatar('move', e);
    const agora = performance.now();
    if (agora - inicioTaxa >= 1000) {
      taxa = Math.round(movimentos * 1000 / (agora - inicioTaxa));
      movimentos = 0;
      inicioTaxa = agora;
    }
    mostrar();
  }, opcoes);

  mostrar();
}
