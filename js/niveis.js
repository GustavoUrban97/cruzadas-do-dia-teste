// Os três níveis de cada dia. A ordem é a dos botões e do index.json.

export const NIVEIS = ['facil', 'media', 'dificil'];

export const NOMES_NIVEIS = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' };

export const nivelValido = nivel => NIVEIS.includes(nivel);
