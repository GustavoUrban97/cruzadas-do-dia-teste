// Web Worker: gera um puzzle (esqueleto + preenchimento) sem travar a página.
// Cada esqueleto é preenchido com reparo (gerarCruzada): onde a grade trava,
// entra uma casa de dica. Se não fechar, sorteia outro esqueleto.
// Com "conserto", primeiro tenta trocar só as palavras ruins na grade existente.
import { rng, gerarCruzada, montar, consertar } from './esqueleto.js';

self.onmessage = ({ data: { id, lista, perfil, semente, tentativas = 40, conserto = null, tema = null } }) => {
  if (tema) tema.preferidas = new Set(tema.todas); // dia com tema: as palavras-tema têm preferência
  if (conserto) {
    const ruins = new Set(conserto.ruins);
    for (let s = semente; s < semente + 5; s++) {
      const r = consertar(conserto.grade, ruins, lista, rng(s));
      if (r) { self.postMessage({ id, pronto: { semente: conserto.semente, consertada: true, ...montar(r.g, r.letras) } }); return; }
    }
    self.postMessage({ id, log: 'conserto local não deu; gerando a cruzada inteira' });
  }
  for (let s = semente; s < semente + tentativas; s++) {
    const r = gerarCruzada(rng(s), perfil, lista, { reparos: 12, tema });
    if (r) { self.postMessage({ id, pronto: { semente: s, ...montar(r.g, r.letras) } }); return; }
  }
  self.postMessage({ id, falhou: true });
};
