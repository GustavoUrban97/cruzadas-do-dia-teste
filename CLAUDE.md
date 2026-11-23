# Cruzadas do Dia — cruzada direta para S Pen

Página web pessoal de palavras cruzadas diárias, feita para ser resolvida **à caneta (S Pen) no Samsung Galaxy Tab S9**, com a sensação de fazer a cruzada do jornal no papel. **Três cruzadas por dia (fácil, média e difícil)**, trocando à 00h (horário de Brasília), no espírito do Termo.

O estilo é **cruzada direta** (como as revistas de banca): as dicas ficam dentro da grade, em casas próprias, com uma seta indicando onde a resposta começa e em que direção corre. Não há lista de dicas separada nem numeração.

Publicado no **GitHub Pages** (repositório público) e usado como **página comum no Chrome do tablet** (não é app instalável: sem manifesto, sem ícones, sem "Adicionar à tela inicial"). Uso exclusivamente pessoal: sem login, sem backend, sem servidor próprio.

## Como trabalhar neste projeto

- Antes de implementar cada etapa, apresente o plano (arquivos, decisões, dúvidas) e espere aprovação.
- Agrupe as mudanças por etapa em vez de fazer alterações picadas.
- Comentários e textos da interface em português do Brasil.
- Ao final de cada etapa, rode o validador e um servidor local (`python3 -m http.server`) e diga como testar no tablet.
- Faça commits por etapa, com mensagens em português.
- **A cada mudança em HTML, CSS ou JS, suba a `VERSAO` em `sw.js` e em `js/app.js`** (as duas iguais). Sem isso o tablet continua com a versão guardada pelo service worker.

## Princípio central: é papel, não formulário

- Enquanto eu escrevo, o app **não ajuda**: só guarda os traços. Ele só **confere quando eu peço** (botão **Conferir**), e mesmo assim não mostra a resposta: marca as casas erradas e as que não conseguiu ler.
- A grade é uma folha onde se desenha livremente: letra no quadrado, palpite pequeno no canto, rabisco, riscar a dica resolvida na própria casa de dica.
- **Sem botão Revelar.** As respostas só aparecem se eu **desistir** (como o Termo mostra a palavra quando a gente perde) ou no **gabarito** dos dias passados.
- A escrita à caneta é lida por um modelo de letras que roda no próprio aparelho (`js/reconhecer.js`, modelo em `modelo/`): como o app sabe a resposta de cada casa, ele só confere se a tinta parece a letra esperada. Só a **caneta** conta; o **lápis** é rascunho e nunca é conferido; o que está nas casas de dica (riscar a dica) é ignorado. A leitura também aprende a letra de quem joga (`js/memoria.js`): as casas das cruzadas resolvidas viram exemplos confirmados, guardados só no aparelho, e cada casa nova é comparada com os mais parecidos.

## Stack

- **HTML + CSS + JavaScript puro (ES modules), sem etapa de build.** O GitHub Pages serve os arquivos como estão. Sem frameworks e sem npm no app.
- `sw.js` (service worker): guarda os arquivos da página para abrir sem internet e controla as versões (aviso "Atualização disponível"). Não há manifesto: a página não é instalável.
- Persistência local: **IndexedDB** para a tinta (traços e letras digitadas) e o registro, com chave `[data, nivel]` (banco versão 4; a loja `memoria` guarda os resumos das letras confirmadas, sai da tinta e não entra no backup). `localStorage` só para preferências leves (ferramenta, cor, nível, gabarito visível e o dia do lembrete dispensado). Sempre com try/catch.
- Alvo: Chrome no Android 14+ (Tab S9; também celular, como o S24, só no modo teclado). Não precisa suportar outros navegadores, mas não deve quebrar no Chrome desktop (útil para desenvolver com mouse).

## Estrutura do repositório

```
index.html
sw.js              # service worker (offline + versões)
css/estilo.css
js/app.js          # inicialização, roteamento por data, barra, avisos
js/grade.js        # renderiza a grade com as casas de dica e as setas
js/tinta.js        # captura e desenho dos traços (pincel, borracha, desfazer), letras digitadas
js/teclado.js      # modo teclado: seleção de casa, teclado na tela, faixa da dica
js/armazenamento.js# IndexedDB
js/datas.js        # "hoje" em America/Sao_Paulo, formatação
js/diagnostico.js  # tela ?debug=1
js/historico.js    # painel "Meu histórico": estatísticas, calendário, backup
js/reconhecer.js   # reconhecimento das letras à caneta (modelo em modelo/), para conferir
js/memoria.js      # memória de letras: aprende a letra de quem joga com as cruzadas resolvidas (só no aparelho)
js/conferencia.js  # botão Conferir: leitura em segundo plano, marcas, resultado
js/niveis.js       # os três níveis (fácil, média, difícil)
puzzles/
  index.json       # lista de datas disponíveis (gerado pelo validador)
  2026-11-07-facil.json   # um arquivo por nível: -facil, -media, -dificil
  2026-11-07-media.json
  2026-11-07-dificil.json
tools/
  validar.py
  proibidas.txt    # palavras que o gerador nunca usa
  temas.json       # dias com tema (Vingadores em 17/12; datas especiais no futuro)
  gerador.html     # gerador de cruzadas (roda no navegador)
  gerador/         # módulos do gerador (esqueleto, palavras, perfis, variedade, worker)
  reconhecer.html  # teste do reconhecimento de letras (S Pen), fora do app
  treino/treinar_letras.py  # treina o modelo de letras (roda no GitHub Actions)
modelo/            # modelo de letras (letras.json + letras.bin, float16), gerado pelo treino
.github/workflows/validar.yml
.github/workflows/treinar-letras.yml   # treino do modelo (quando tools/treino muda ou à mão)
```

## Entrada (o ponto mais importante)

Usar **Pointer Events** (`pointerType`):

| Entrada | Comportamento |
|---|---|
| `pen` | Desenha com a ferramenta ativa |
| `pen` com borracha (`buttons & 32`) ou botão lateral pressionado | Apaga traços tocados |
| `touch` (dedo/palma) | **Nunca desenha** (rejeição de palma). Serve para tocar na barra de ferramentas |
| `mouse` | Desenha (só para desenvolver no PC); botão direito apaga |

- Tela de diagnóstico `?debug=1` mostra os eventos de ponteiro recebidos (tipo, `button`, `buttons`, pressão, tamanho).
- `?hoje=AAAA-MM-DD` finge que hoje é outra data (testar o fluxo de "ontem" sem esperar a meia-noite).
- Latência: `touch-action: none` na área de desenho, `getCoalescedEvents()` para traço suave, `requestAnimationFrame`, e só o trecho novo do traço é desenhado a cada quadro.
- **Não usar `desynchronized: true`** nas camadas de tinta: no Tab S9 a parte transparente do canvas fica preta e cobre a grade. Fica atrás de `?baixalatencia=1` só para experimentos.
- **Sem previsão de pontos** (`getPredictedEvents`) por padrão: o "traço futuro" ficou perceptível no Tab S9. `?previsao=1` liga para comparar.
- Pincel: traço desenhado como forma preenchida (círculos + pontes tangentes), curva pelos pontos médios, pressão suavizada, início levemente afinado. O mesmo pincel desenha ao vivo e redesenha traços salvos.
- Canvas dimensionado com `devicePixelRatio` para não ficar borrado.
- Ferramentas na barra: **Caneta** com três cores — **preta** (padrão), **azul** e **vermelha** (tons de esferográfica) —, **Lápis** (cinza, mais fino, para palpites), **Borracha**, **Teclado**, **Desfazer**, **Refazer**. Cada traço guarda sua cor.
- A borracha apaga o traço inteiro tocado (estilo Samsung Notes), não pixel a pixel.

## Modo teclado (alternativa à caneta)

A caneta continua sendo a forma principal; o teclado é uma ferramenta a mais na barra, para PC ou tablet.

- Com **Teclado** ativo, tocar numa casa (dedo, caneta ou mouse) **seleciona** em vez de desenhar; a ponta-borracha e o botão lateral continuam apagando. Tocar de novo na mesma casa troca horizontal/vertical; tocar numa casa de dica seleciona a palavra daquela dica (metade de cima ou de baixo).
- A palavra selecionada fica destacada (amarelo claro) e a sua dica aparece numa **faixa** acima do teclado (seta + texto), com **◀ ▶** para ir à palavra anterior/seguinte (ordem da casa onde cada palavra começa; para na primeira casa vazia).
- **Teclado próprio** no estilo do Termo (A–Z, ⌫, ⇄ para trocar a direção), sem corretor e sem empurrar a página como o teclado do Android. No PC também vale o teclado físico (letras, Backspace, Delete, setas, espaço troca a direção); acento e cedilha viram a letra simples.
- Letra digitada avança para a próxima casa vazia da palavra; ⌫ apaga a casa ou, se vazia, volta uma e apaga.
- Retrato: o teclado fica embaixo da grade (a grade desconta a altura). Paisagem larga: fica ao lado (`--posicao: lado` no CSS faz `ajustarTamanho` descontar a largura).
- As letras ficam por casa (`letras: {"linha,coluna": "A"}` no mesmo registro da tinta), em letra de forma, por baixo da tinta. Dá para misturar caneta e teclado no mesmo dia. A borracha passando no meio da casa apaga a letra; desfazer/refazer valem para traços e letras na mesma sequência.
- Letras digitadas entram na conferência direto (comparação exata). No **gabarito**, cada letra digitada certa ganha fundo verde claro e a errada fica riscada, com a certa pequena em verde no canto; aparece "Letras digitadas: X de Y certas". 
- **Celular** (tela com menos de 600 px, mesmo limite no CSS e em `js/app.js`): o modo teclado fica sempre ligado e as ferramentas de caneta (caneta, cores, lápis, borracha, botão Teclado) somem; a barra de escrita fica com Desfazer, Refazer e Terminei. Cabeçalho compacto: data curta ("sáb, 07/11"), sem número do puzzle/versão, barras podem quebrar linha em vez de cortar. Margem lateral de 6 px (o gesto de voltar só atrapalha a caneta). O texto das dicas dentro da grade fica minúsculo; a leitura é pela faixa (tocar na casa ou ◀ ▶). No gabarito, "Ocultar gabarito" vira "Ocultar". Deitado não tem layout especial.

## Layout

- **Retrato é a orientação principal.** A grade (sempre 13×17) ocupa a tela toda; as casas podem ser um pouco mais altas que largas, como na revista. Em paisagem a grade fica centralizada (menor).
- Visual de revista: fundo papel (off-white), linhas finas pretas, **casas de dica em cinza bem claro** com texto pequeno centralizado em fonte serifada. Casa com duas dicas: dividida ao meio por linha tracejada, uma dica em cada metade.
- Setas pequenas na borda da casa onde a resposta começa, sem atrapalhar a escrita da letra.
- **Banco** (como no jornal): faixa fina embaixo da grade, à direita, com algumas palavras raras da própria grade escritas **de ponta-cabeça**, sempre visível. Fica fora da camada de tinta (não muda as coordenadas dos traços); a grade desconta a altura dela.
- A camada de tinta cobre a grade inteira (casas de letra e de dica aceitam escrita).
- Traços salvos em **coordenadas normalizadas** relativas à grade, para continuarem no lugar ao girar a tela ou redimensionar.
- Cabeçalho em **duas barras**: em cima o dia (data por extenso, seletor **Fácil · Média · Difícil**, número do puzzle e versão discretos, Ontem/Hoje e o ícone do histórico); embaixo a escrita (caneta e cores, lápis, borracha, teclado, desfazer, refazer) e o **Conferir** à direita. Em retrato a grade é limitada pela largura, então a segunda barra não a diminui. Tudo precisa caber em ~600 px de largura (o ano da data some abaixo de 760 px); abaixo de 600 px vale o layout de celular (ver Modo teclado).
- Sem rolagem acidental nem zoom do navegador ao escrever (`user-scalable=no` no viewport é aceitável aqui).
- Margem lateral de ~24px em volta da grade: no Tab S9 com navegação por gestos, escrever colado na borda dispara o "voltar" do Android. Embaixo, 32px (mais a área segura): o canto de baixo da grade caía na zona do gesto do assistente e a caneta não escrevia ali. Além disso, depois de cada traço o app arma uma entrada extra no histórico, para o primeiro gesto de voltar acidental não sair da página (o Chrome só respeita `pushState` feito logo após uma ação do usuário, por isso é rearmado no fim do traço).

## Ciclo diário

- "Hoje" = data atual em `America/Sao_Paulo`, via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` (formato AAAA-MM-DD). Nunca usar a data UTC.
- Puzzles do dia: `puzzles/AAAA-MM-DD-nivel.json` (nivel = `facil`, `media` ou `dificil`). Se a data não tiver o nível em `puzzles/index.json`, usar um fallback determinístico por nível (dias desde o primeiro puzzle daquele nível, ciclando pelos disponíveis) e mostrar um aviso discreto de que o banco precisa de puzzles novos.
- **Níveis:** cada nível é uma cruzada independente, com tinta, Terminei, gabarito e avaliação próprios. Os três têm 13×17; a dificuldade vem das palavras (comuns no fácil, menos usuais no difícil) e do estilo das dicas (diretas no fácil, indiretas e com jogo de palavras no difícil). O app abre no último nível usado (`?nivel=` força um). O que foi salvo antes dos níveis virou "Média".
- Se a página estiver aberta na virada da meia-noite (checar a cada minuto e ao voltar ao primeiro plano via `visibilitychange`), mostrar "Novo puzzle disponível" sem trocar à força no meio de um traço.
- A tinta de cada dia é salva por data, ao fim de cada traço.

## Offline e atualizações

- Service worker com cache do "casco" (HTML, CSS, JS), versionado por `VERSAO`; caches antigos são apagados na ativação.
- Puzzles e `index.json`: *network-first* com fallback para cache, para pegar puzzles novos assim que eu fizer push, mas abrir offline.
- Pré-carregar os puzzles dos próximos 7 dias quando houver rede.
- Versão nova publicada → o service worker novo fica esperando e aparece "Atualização disponível · toque para recarregar". Nunca recarrega sozinho; antes de recarregar, grava a tinta.

## Gabarito, registro do dia e histórico

Sem ajuda enquanto escrevo; conferir só quando eu peço:

- **Hoje:** a folha e o botão **Conferir**. O app lê em segundo plano cada casa logo depois de cada traço (uns 16 ms por casa), então conferir é imediato. Só confere com a grade **completa**: com casas vazias, não confere nada nem conta tentativa, só marca as vazias (pontinho amarelo) e diz "Faltam N casas · o lápis não conta". Completa: cada Conferir conta uma tentativa. Tudo certo → "Tudo certo! 🎉" e o dia fica **resolvido**. Senão, marca as casas **erradas** (círculo laranja) e as que **não conseguiu ler** (contorno cinza tracejado), sem mostrar a resposta, e uma faixa diz quantas estão erradas e ilegíveis, com **"As ilegíveis estão certas"** (o reconhecimento falhou: contam como certas) e **"Desistir"** (mostra as respostas na hora). Reescrever uma casa tira a marca dela. Botão "Ontem" abre o gabarito de ontem, e um lembrete aparece se ontem foi escrito e ficou sem conferir; o ✕ dele dispensa o aviso daquele dia (nos três níveis, sem mudar o registro).
- **Registro automático:** resolveu na 1ª conferência = **acertei tudo**; resolveu depois de corrigir = **errei algumas**; desistiu, ou o dia passou sem resolver = **não terminei**. Registro: `conferencias`, `resolvido`, `desistiu` e a `avaliacao` correspondente (os dias avaliados à mão antes disso continuam como estão).
- **Dias passados (gabarito):** a grade com a minha tinta e as respostas sobrepostas **em verde, levemente transparente** (verde para não confundir com nenhuma das cores de caneta), as casas erradas marcadas em laranja e uma faixa dizendo como o dia terminou ("Resolvida na 2ª conferência", "Desisti", "Ficou sem conferir"). As letras verdes ficam por baixo da tinta e podem ser ocultadas. Dia futuro nunca mostra respostas.
- Dia em que nem abri a página: **não jogou**.
- **Sequência** (por nível): dias seguidos em que **terminei** o puzzle (acertando tudo ou errando algumas). "Não terminei" e "não jogou" quebram a sequência, assim como dia passado escrito e não resolvido. "Terminei" sem avaliação (dos dias de antes da conferência) conta. Hoje em andamento não quebra.
- **Estatísticas** no estilo do Termo: dias jogados, % de "acertei tudo", sequência atual e melhor sequência, distribuição em quantas conferências resolveu (1ª, 2ª, 3ª, 4ª ou mais, como as tentativas do Termo; a barra de hoje fica destacada), mais "não terminei" e, só se houver, "errei (sem contagem)" para os dias avaliados à mão antes do Conferir. A % é sobre os dias avaliados. Fica no painel "Meu histórico" (ícone de gráfico no cabeçalho), com uma aba por nível: cada nível tem estatísticas, sequência e calendário próprios, como no Termo.
- **Histórico:** calendário dos dias com a cor de cada um (a dica de cada dia, que aparece passando o mouse no PC, diz "resolvida na Nª conferência"); tocar abre o puzzle daquele dia com a minha tinta e o gabarito. Dias passados continuam editáveis, mas editar não altera o registro já marcado.
- **Backup:** exportar toda a tinta e o registro dos dias como um arquivo JSON e importar de volta (troca de tablet ou dados do Chrome apagados). Formato 3 (cada entrada com `nivel` e, se houver, `letras`); backups nos formatos 2 e 1 continuam entrando; um backup no formato 1, de antes dos níveis, entra como "Média". Importar substitui, neste aparelho, os puzzles que estão no arquivo; os outros ficam.

## Formato do puzzle (JSON)

```json
{
  "id": 1,
  "data": "2026-11-07",
  "nivel": "media",
  "titulo": "Direta do sábado",
  "autor": "Gustavo",
  "largura": 13,
  "altura": 17,
  "grade": ["#############", "#SOPA#......", "..."],
  "banco": ["AMA", "ANU", "SOR"],
  "dicas": [
    { "linha": 1, "coluna": 0, "direcao": "direita", "texto": "Caldo quente", "resposta": "SOPA" },
    { "linha": 0, "coluna": 1, "direcao": "baixo", "texto": "___ Catarina", "resposta": "SANTA" }
  ]
}
```

- **Tamanho fixo: 13 colunas × 17 linhas**, todo dia e nos três níveis.
- `tema` (opcional): `{"nome": "Vingadores: Doutor Destino", "cor": "#cdbde9", "destaque": "#2b1d45", "fonte": "Russo One", "enfeite": "raio"}` nos dias com tema, igual nos três níveis. Campos opcionais: `destaque` (fundo escuro), `borda`, `fonte` (família do Google Fonts, carregada só nesse dia; sem internet cai na serifada) e `enfeite` (`raio` ou `estrela`). O app vira "edição especial": faixa de capa com o nome do tema na `fonte`, margens escuras com retícula de gibi, borda grossa na grade, casas de dica na `cor` (sem vermelho nem verde), Conferir escuro e o enfeite ao lado da data (pedido de 23/11: "visual mais agressivo"); o validador põe `"temas": {"AAAA-MM-DD": "nome"}` no `index.json` e o calendário do histórico marca esses dias com ★.
- `banco` (opcional): palavras de ajuda mostradas de ponta-cabeça embaixo da grade. Todas precisam estar na grade. O gerador escolhe as mais raras (de preferência de 3 a 5 letras, nunca proibidas): 5 no fácil, 4 na média, 3 no difícil.
- `nivel`: `facil`, `media` ou `dificil`; o arquivo se chama `AAAA-MM-DD-nivel.json`. O `id` é único entre todos os puzzles.
- `#` = casa de dica. Casa `#` sem nenhuma dica aparece como casa preta. Letras maiúsculas sem acento (padrão de cruzadas brasileiras).
- Cada dica fica na casa `(linha, coluna)`, que precisa ser `#`. No máximo **2 dicas por casa**; a primeira da lista ocupa a metade de cima (de preferência a que aponta para a direita, → ou ↴; a que desce fica embaixo). Quando as duas saem pela lateral (→ e ↴), cada seta fica na altura da sua dica.
- **Cada puzzle tem o seu próprio esqueleto** (posição das casas de dica), inclusive a primeira linha e a primeira coluna: nada de padrão fixo repetido entre níveis ou dias.
- `direcao` (de onde começa a resposta, a partir da casa da dica):
  - `direita` (→): começa na casa à direita e corre para a direita.
  - `baixo` (↓): começa na casa de baixo e desce.
  - `baixo-direita` (↳): começa na casa de baixo e corre para a direita.
  - `direita-baixo` (↴): começa na casa à direita e desce.
- A resposta vai até a próxima casa `#` ou a borda.
- Dicas curtas (idealmente até ~20 caracteres, 1 a 3 palavras), para caberem na casinha.
- O repositório é público, então as respostas ficam visíveis no código. Isso é aceito; não é preciso ofuscar.

## Conteúdo: pasta `tools/`

Fora do app (não entram no service worker):

1. `validar.py` — lê todos os JSON de `puzzles/` e falha se: grade diferente de 13×17; caractere inválido; dica fora de casa `#` ou apontando para casa que não é letra; mais de 2 dicas na mesma casa; palavra da grade (2+ letras) sem dica, ou com mais de uma; `resposta` não bate com a grade; palavra repetida no mesmo puzzle; `banco` com palavra que não está na grade; `nivel` ausente ou inválido; nome do arquivo diferente de `data-nivel`; `id` repetido. Avisa (sem falhar) sobre dicas longas demais e sobre mais de 4 dicas de completar ("___" ou "(?)") no puzzle. Ao final, **regenera `puzzles/index.json`** no formato `{"datas": {"AAAA-MM-DD": ["facil", "media", "dificil"]}}`.
2. `gerador.html` — página em JavaScript (sem build) que roda no navegador com o servidor local (`http://localhost:8000/tools/gerador.html`). Gera um lote (dias × níveis) em Web Workers. Sorteia um esqueleto 13×17 diferente a cada puzzle (bordas e miolo; toda palavra com seta para o seu início, toda casa de dica com ao menos uma dica) e preenche com palavras em português (lista de frequência FrequencyWords pt_br_50k filtrada pelo dicionário pythonprobr/palavras, ambas baixadas por URL e fora do repositório por causa das licenças; até 11 letras; sem acentos; sem as palavras de `tools/proibidas.txt`: estrangeirismos, siglas, nomes próprios, palavrões, temas sensíveis; por nível: fácil com as 8.500 palavras mais comuns, média com as 9.500, difícil com as menos usuais primeiro; em todos, as de 4–5 letras fora do corte entram no fim da fila, porque são poucas e são as que mais travam; palavras de 2–3 letras de uma lista escolhida a dedo; numerais e ordinais nunca; formas verbais conjugadas, como ANDAVA ou PARTIU, vão para o fim da fila; ~120 palavras "de revista" — bichos, frutas, plantas, instrumentos, objetos — sobem para a posição 3.000 da lista; e uma lista curada de nomes próprios em `tools/gerador/palavras.js` (`NOMES`: países, capitais, rios, estados, personagens da literatura e da mitologia, figuras históricas; sem times, marcas nem pessoas vivas) entra na posição 6.000, no máximo 1/2/3 por cruzada no fácil/média/difícil). **Palavras longas, poucas curtas** (pedido de 18/11: "q tara por palavras de 3 letras"): perfis em `tools/gerador/perfis.js` com ~56 casas de dica, palavras de até 9 letras, no máximo 4–5 de 2 letras e 8–12 de 3 (antes eram ~10 e ~26); até ~32 letras do miolo podem ficar sem cruzamento. Em 21/11 foi pedido "usar menos palavras de 2 a 4 letras": testado, apertar os limites além destes (ou limitar as de 4 letras com `maxQuatro`) não fecha a grade em minutos, porque o português tem poucas curtas boas (só ~200 de 2–3 letras com definição); com este vocabulário, ~metade das palavras fica com 2–4 letras. **Como preenche** (`esqueleto.js`): índice de bits por (tamanho, posição, letra), vaga com menos opções primeiro, cada palavra testada contra as cruzadas antes de entrar, várias tentativas curtas por esqueleto e **reparo**: onde a grade trava sempre, entra uma casa de dica no meio da vaga (`gerarCruzada`). Variantes da mesma palavra (plural, gênero, -M/-R/-AM: EDITOR/EDITORA/EDITORES, LISA/LISOS) nunca entram juntas na grade; entre as cruzadas do lote e com as publicadas de 7+ letras do mês, o gênero e o número também contam como repetição (COREANO ontem, nem COREANA hoje). Os motivos dos descartes ficam em `descartados` (variedade.js). Gerar sempre na ordem média → fácil → difícil: a fácil gerada depois das outras duas do mesmo dia trava (as curtas do dia vão para o fim da fila). Uma cruzada leva de 10 s a 2 min com 8 trabalhos. **Variedade** (`tools/gerador/variedade.js`; foi pedido: "um jogo realmente diferente do outro"): gera uma cruzada por vez, dia a dia e média → fácil → difícil, cada uma sabendo o que as anteriores usaram, com vários trabalhos em paralelo por cruzada; palavras de 5+ letras não se repetem dentro do lote (nem entre os níveis do dia); publicadas de 7+ letras não voltam em 30 dias; de 5–6 letras não voltam em 14 dias e, de 15 a 30 dias, vão para o fim da fila (proibir todas trava a grade); curtas de 3–4 letras do mesmo dia e as muito usadas nos vizinhos (±7 dias) vão para o fim da fila; de 3–4 letras usadas 15+ vezes no mês ficam de fora; AMO e AMA nunca. O vocabulário inteiro (até a posição 12.000) foi revisado em 18/11 e as ruins foram para `tools/proibidas.txt`; mesmo assim, **conferir as palavras de cada cruzada gerada** antes de escrever as dicas e acrescentar as ruins lá. Depois de escrever as dicas, conferir com script que nenhum texto repete os dos últimos 30 dias (é fácil escrever igual sem perceber). **Dicas de completar ("___"): no máximo 4 por cruzada** (pedido de 21/11, com uma direta de revista como referência: lá são ~2 em 45); o resto é definição, às vezes com etiqueta como "(pl.)", "(fem.)", "(gír.)", "(Mús.)". Atribui cada palavra a uma casa de dica vizinha (no máximo 2 por casa), aplica os textos das dicas colados em JSON (`{"facil": {"PALAVRA": "texto"}}`, por nível ou por arquivo) escolhe o `banco` e salva os arquivos e o `index.json` na pasta `puzzles/` ("Salvar na pasta…", Chrome/Edge no PC). Títulos pelo dia da semana: "Terça tranquila", "Terça-feira", "Terça de mestre". **Dias com tema** (`tools/temas.json`, por data ou "MM-DD" para os que voltam todo ano; ideia de 23/11: aproveitar o hype de lançamentos, como a estreia de Vingadores em 17/12, e depois as datas especiais): uma parte sorteada das palavras-tema vai para a frente da fila e a grade precisa ter de `minimo` a `maximo` delas por nível (senão é descartada); elas valem mesmo se forem nomes ou estiverem em `proibidas.txt`, não seguem a regra do mês, mas não se repetem entre os níveis do dia. O tema pode estar só na dica (ESCUDO → "Arma do Capitão América"), já que estrangeirismos não entram. Dicas sem spoiler do filme. O título vem do tema.
3. Dicas escritas em lotes (lotes de 10 dias) e revisadas por mim. Não copiar puzzles de revistas, jornais ou apps.

## GitHub Pages e CI

- Publicação: Settings → Pages → *Deploy from a branch* → `main`, pasta `/` (raiz). Sem build.
- Usar sempre caminhos relativos (o site roda em `/<nome-do-repo>/`, não na raiz do domínio).
- `.github/workflows/validar.yml`: a cada push e pull request, roda `python3 tools/validar.py` e falha se algum puzzle estiver inválido ou se `index.json` estiver desatualizado.
- `README.md` curto: o que é, como rodar localmente, como adicionar puzzles, como abrir no tablet.

## Etapas

1. **Esqueleto:** estrutura de pastas, `index.html`, leitura do puzzle de exemplo, grade no formato direta (sem tinta), cálculo de "hoje" em Brasília. `tools/validar.py` e o workflow. ✔
2. **Tinta:** desenho com caneta, rejeição de palma, borracha (ferramenta e botão), lápis, desfazer/refazer, pressão, tela de diagnóstico `?debug=1`. ✔
3. **Persistência e ciclo diário:** IndexedDB por data, virada da meia-noite, fallback de puzzle, proteção do gesto de voltar. ✔
4. **Cores e offline:** caneta preta/azul/vermelha, service worker (offline + aviso de atualização). Sem manifesto/instalação. ✔
5. **Conferência:** botão "Terminei", gabarito de ontem em verde, avaliação do dia (acertei tudo / errei algumas / não terminei), registro do dia no IndexedDB. ✔
6. **Histórico, estatísticas e backup:** calendário, sequência, estatísticas estilo Termo, exportar/importar. ✔
7. **Cabeçalho em duas barras e três níveis:** seletor Fácil/Média/Difícil, tinta e registro por nível (migração do que já existia para "Média"), histórico com abas por nível, backup formato 2, um puzzle de exemplo de cada nível. ✔
8. **Conteúdo:** gerador em `tools/gerador.html` (o Python ficou só no validador) e um banco inicial de 30 dias × 3 níveis, em 3 lotes de 10 dias.
9. **Modo teclado:** ferramenta Teclado, teclado próprio estilo Termo, faixa da dica atual, letras salvas com a tinta, conferência das letras digitadas no gabarito, backup formato 3. ✔
10. **Celular:** layout para tela estreita (S24) só com o modo teclado, cabeçalho compacto, ◀ ▶ na faixa da dica. ✔
11. **Conferir a caneta:** modelo de letras treinado no EMNIST ByMerge, só letras, com maiúscula e minúscula de desenho diferente separadas (A e a, R e r; o app soma as duas), sorteio com o mesmo peso por letra e deformação elástica (GitHub Actions, ~42 min, rede pequena, ~95,1% no teste, 269 KB em float16, no cache offline; o treino abre parte dos O e falha o traço de vez em quando, porque O sem fechar em cima virava U), `js/reconhecer.js` (traços da casa → imagem 28×28 como o EMNIST → rede em JS puro; certa / errada / ilegível sabendo a letra esperada; letras parecidas com a esperada, como U, C ou J no lugar de O, nunca contam como erradas), página de teste `tools/reconhecer.html` e `js/conferencia.js` (leitura em segundo plano, botão Conferir, marcas, Desistir, registro automático). Em 21/11, com A de topo redondo saindo ilegível, entrou a **memória de letras** (`js/memoria.js`: até 80 exemplos por letra das 30 cruzadas resolvidas mais recentes, 10 vizinhos mais próximos na penúltima camada, mistura meio a meio com a rede; refeita sozinha em segundo plano quando o modelo muda). Medido na tinta de 13 cruzadas (ferramenta fora do repositório, em `tools/_letra/`): ilegíveis 30 → 9, A 16 → 1. ✔

## Critérios de aceite

- Apoiar a palma na tela enquanto escrevo não gera nenhum traço.
- O traço acompanha a caneta sem atraso perceptível no Tab S9.
- Fechar o Chrome (ou reiniciar o tablet) e reabrir mantém exatamente o que escrevi.
- Girar a tela mantém cada traço no quadrado onde foi escrito.
- À 00h de Brasília aparece um puzzle novo, e o de ontem continua acessível com gabarito.
- A página abre sem internet.
- Um push com puzzles novos ou versão nova chega ao tablet sem limpar cache nem reinstalar nada.

## Fora do escopo (por enquanto)

App instalável (PWA), botão Revelar, zoom na grade, celular deitado, sincronização entre aparelhos, contas, compartilhamento de resultado.
