# Rótulos personalizados do radar — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir personalizar os rótulos dos eixos do radar — edição inline no gráfico, imagem PNG por eixo, tamanho individual — com desfazer/refazer, refletido na tela e nos PNGs exportados.

**Architecture:** App single-file (`index.html`, vanilla JS + Chart.js). Estado por eixo em arrays paralelos a `eixos[]` (`eixosLabels`, `eixosImagens`, `eixosTamanho`). Histórico em memória de snapshots da config. Lógica pura (mover arrays paralelos + pilha de histórico) é testável em Node; partes de DOM/canvas são verificadas manualmente.

**Tech Stack:** HTML/CSS/JS vanilla, Chart.js 4, localStorage. Testes de lógica pura via Node (`node`), verificação visual via skill `verify`.

## Global Constraints

- Arquivo permanece **single-file** (`index.html`) — sem dependências novas, sem arquivos externos servidos.
- Manter UTF-8 íntegro (acentos/emoji). Validar com `iconv -f UTF-8 -t UTF-8` antes de cada commit.
- Não quebrar funcionalidades existentes: modos texto/emoji/custom, arrastar-para-reordenar, Estúdio, Lote.
- Imagens: downscale para máx. **128px** (lado maior) antes de guardar; persistir em `localStorage` (`copaConfig`).
- Histórico: máx. **50** snapshots, em memória (não persiste).
- Atalhos: **Ctrl+Z** desfaz, **Ctrl+Shift+Z** e **Ctrl+Y** refazem; ignorados quando o foco está em input/textarea/select.
- Repo é a fonte oficial. Após cada task: commit. Deploy (push + verificação do Pages) só na task final.

---

### Task 1: Helpers puros — mover arrays paralelos + pilha de histórico (Node TDD)

**Files:**
- Modify: `index.html` (adicionar bloco de helpers puros, demarcado por marcadores)
- Test: `docs/plans/tests/test_helpers.mjs` (test runner Node que extrai os helpers do `index.html`)

**Interfaces:**
- Produces:
  - `moverParalelo(arrays, from, to)` — `arrays`: objeto `{eixos, eixosLabels, eixosImagens, eixosTamanho}`; move o item de `from` para `to` em TODOS os arrays com a mesma semântica do drop atual (índice `to` já ajustado pelo chamador). Muta os arrays.
  - `histPush(h, snap, limit)` — `h`: `{lista, ptr}`; trunca redo, empurra `snap`, aplica `limit`. Muta `h`. Retorna `h`.
  - `histUndo(h)` — retorna o snapshot anterior (`lista[--ptr]`) ou `null` se `ptr<=0`. Muta `h.ptr`.
  - `histRedo(h)` — retorna o próximo snapshot (`lista[++ptr]`) ou `null` se já no fim. Muta `h.ptr`.
  - `podeDesfazer(h)` → bool (`ptr>0`); `podeRefazer(h)` → bool (`ptr<lista.length-1`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `docs/plans/tests/test_helpers.mjs`:

```js
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

// Extrai o bloco de helpers puros do index.html (fonte única da verdade)
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ ===PURE-HELPERS-START===([\s\S]*?)\/\/ ===PURE-HELPERS-END===/);
assert(m, 'Bloco PURE-HELPERS não encontrado no index.html');
const mod = {};
new Function('exports', m[1] + '\nexports.moverParalelo=moverParalelo;exports.histPush=histPush;exports.histUndo=histUndo;exports.histRedo=histRedo;exports.podeDesfazer=podeDesfazer;exports.podeRefazer=podeRefazer;')(mod);

// moverParalelo mantém todos os arrays alinhados
{
  const arrays = { eixos:['A','B','C'], eixosLabels:['a','b','c'], eixosImagens:[null,null,'img'], eixosTamanho:[1,2,3] };
  mod.moverParalelo(arrays, 2, 0); // move C para o início
  assert.deepStrictEqual(arrays.eixos, ['C','A','B']);
  assert.deepStrictEqual(arrays.eixosTamanho, [3,1,2]);
  assert.deepStrictEqual(arrays.eixosImagens, ['img',null,null]);
}

// histPush + undo/redo
{
  const h = { lista: [], ptr: -1 };
  mod.histPush(h, {v:1}, 50); mod.histPush(h, {v:2}, 50); mod.histPush(h, {v:3}, 50);
  assert.strictEqual(h.ptr, 2);
  assert.deepStrictEqual(mod.histUndo(h), {v:2});
  assert.deepStrictEqual(mod.histUndo(h), {v:1});
  assert.strictEqual(mod.histUndo(h), null);           // nada antes
  assert.deepStrictEqual(mod.histRedo(h), {v:2});
  // novo push após undo descarta o redo
  mod.histPush(h, {v:9}, 50);
  assert.strictEqual(mod.histRedo(h), null);
  assert.strictEqual(h.lista.length, 3);               // [v1, v2, v9]
}

// limite descarta os mais antigos
{
  const h = { lista: [], ptr: -1 };
  for (let i=0;i<60;i++) mod.histPush(h, {v:i}, 50);
  assert.strictEqual(h.lista.length, 50);
  assert.strictEqual(h.lista[0].v, 10);
}

console.log('OK: helpers puros');
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node ~/Documents/radar-copa/docs/plans/tests/test_helpers.mjs`
Expected: FAIL — `Bloco PURE-HELPERS não encontrado` (ainda não existe).

- [ ] **Step 3: Implementar os helpers no index.html**

Inserir logo após a definição de `let eixos = [...]` / estado global (perto da linha ~648), um bloco:

```js
// ===PURE-HELPERS-START===
function moverParalelo(arrays, from, to) {
  for (const k in arrays) {
    const a = arrays[k];
    if (!Array.isArray(a)) continue;
    const item = a.splice(from, 1)[0];
    a.splice(to, 0, item);
  }
}
function histPush(h, snap, limit) {
  h.lista = h.lista.slice(0, h.ptr + 1); // descarta redo pendente
  h.lista.push(snap);
  if (h.lista.length > limit) h.lista.shift();
  h.ptr = h.lista.length - 1;
  return h;
}
function histUndo(h) { return h.ptr > 0 ? h.lista[--h.ptr] : null; }
function histRedo(h) { return h.ptr < h.lista.length - 1 ? h.lista[++h.ptr] : null; }
function podeDesfazer(h) { return h.ptr > 0; }
function podeRefazer(h) { return h.ptr < h.lista.length - 1; }
// ===PURE-HELPERS-END===
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node ~/Documents/radar-copa/docs/plans/tests/test_helpers.mjs`
Expected: `OK: helpers puros`

- [ ] **Step 5: Commit**

```bash
git -C ~/Documents/radar-copa add index.html docs/plans/tests/test_helpers.mjs
git -C ~/Documents/radar-copa commit -m "Helpers puros: mover arrays paralelos + pilha de histórico (testado em Node)"
```

---

### Task 2: Estado por eixo + persistência + commit() central

**Files:**
- Modify: `index.html` — estado global, `salvarConfig`, `carregarConfig`, `processarDados`

**Interfaces:**
- Consumes: `histPush` (Task 1), `salvarConfig`.
- Produces:
  - Globais: `let eixosImagens = []`, `let eixosTamanho = []`, `const HIST = { lista: [], ptr: -1 }`.
  - `snapshotConfig()` → objeto de config (deep clone via `JSON.parse(JSON.stringify(...))`).
  - `commit()` → chama `salvarConfig()` e `histPush(HIST, snapshotConfig(), 50)` e `atualizarBotoesHistorico()` (esta última criada na Task 6; por ora declarar stub vazio).
  - `sincronizarArraysEixos()` → garante que `eixosLabels/eixosImagens/eixosTamanho` tenham o mesmo length de `eixos` (preenche faltantes: label `''`, imagem `null`, tamanho `1`).

- [ ] **Step 1: Adicionar globais e helpers de estado**

Após o bloco PURE-HELPERS, adicionar:

```js
let eixosImagens = [];   // dataURL PNG por eixo (ou null/'' )
let eixosTamanho = [];   // fator de escala por eixo (padrão 1)
const HIST = { lista: [], ptr: -1 };
function atualizarBotoesHistorico() {}  // implementado na Task 6

function sincronizarArraysEixos() {
  for (let i = 0; i < eixos.length; i++) {
    if (eixosLabels[i] === undefined) eixosLabels[i] = '';
    if (eixosImagens[i] === undefined) eixosImagens[i] = null;
    if (eixosTamanho[i] === undefined || !eixosTamanho[i]) eixosTamanho[i] = 1;
  }
  eixosLabels.length = eixos.length;
  eixosImagens.length = eixos.length;
  eixosTamanho.length = eixos.length;
}

function snapshotConfig() {
  return JSON.parse(JSON.stringify({
    eixos, eixosLabels, eixosImagens, eixosTamanho,
    tema: temaAtual, modoLabel,
    cLinha: document.getElementById('cLinha').value,
    cFundo: document.getElementById('cFundo').value,
    opacidade: document.getElementById('rOpacity').value,
    espessura: document.getElementById('rEsp').value,
    ponto: document.getElementById('rPt').value
  }));
}

function commit() {
  salvarConfig();
  histPush(HIST, snapshotConfig(), 50);
  atualizarBotoesHistorico();
}
```

- [ ] **Step 2: Persistir os novos arrays em salvarConfig**

Em `salvarConfig()` (linha ~1203), adicionar ao objeto `cfg`: `eixosImagens, eixosTamanho` (junto de `eixosLabels`, que já existe ou deve ser incluído). Confirmar que `cfg` inclui `eixosLabels`.

- [ ] **Step 3: Restaurar em carregarConfig**

Em `carregarConfig()` (linha ~1217), após restaurar `cfg.eixos`/`cfg.eixosLabels`, adicionar:

```js
    if (Array.isArray(cfg.eixosImagens)) eixosImagens = cfg.eixosImagens;
    if (Array.isArray(cfg.eixosTamanho)) eixosTamanho = cfg.eixosTamanho;
```

- [ ] **Step 4: Sincronizar + baseline do histórico no load de dados**

Em `processarDados()`, após `configurarPainel()` (que define `eixos`), chamar `sincronizarArraysEixos()`. No fim de `processarDados()`, semear o histórico com o estado inicial:

```js
  HIST.lista = []; HIST.ptr = -1;
  histPush(HIST, snapshotConfig(), 50);
  atualizarBotoesHistorico();
```

- [ ] **Step 5: Verificar manualmente (sem regressão) e commit**

Abrir o app, carregar dados de exemplo (colar TSV), recarregar a página: sem erros no console; radar renderiza igual. Validar UTF-8.

```bash
iconv -f UTF-8 -t UTF-8 ~/Documents/radar-copa/index.html >/dev/null && echo OK
git -C ~/Documents/radar-copa add index.html
git -C ~/Documents/radar-copa commit -m "Estado por eixo (imagem/tamanho) + persistência + commit() central"
```

---

### Task 3: UI lateral — botão de imagem, remover imagem e slider de tamanho por eixo

**Files:**
- Modify: `index.html` — `renderAxisList` (linha ~1038) e CSS (`<style>`)

**Interfaces:**
- Consumes: `eixosImagens`, `eixosTamanho`, `commit`, `renderRadar`, `renderAxisList`.
- Produces: `redimensionarImagem(file, maxLado)` → `Promise<string>` (dataURL PNG ≤ maxLado).

- [ ] **Step 1: Helper de redimensionamento de imagem**

Adicionar perto dos demais utilitários:

```js
function redimensionarImagem(file, maxLado = 128) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
```

- [ ] **Step 2: Adicionar controles na linha do eixo**

Em `renderAxisList`, dentro do `eixos.forEach`, após o `inp` (campo de texto) e antes do `rm`, criar: botão de imagem (abre file input), botão de remover imagem (só aparece se houver imagem) e slider de tamanho. Inserir:

```js
    // Botão de imagem PNG
    const imgBtn = document.createElement('label');
    imgBtn.className = 'axis-img-btn';
    imgBtn.title = 'Usar imagem PNG no lugar do rótulo';
    imgBtn.textContent = eixosImagens[i] ? '🖼️*' : '🖼️';
    imgBtn.style.display = modoLabel === 'custom' ? '' : 'none';
    const imgInput = document.createElement('input');
    imgInput.type = 'file'; imgInput.accept = '.png,.jpg,.jpeg'; imgInput.style.display = 'none';
    imgInput.onchange = async () => {
      if (!imgInput.files[0]) return;
      try {
        eixosImagens[i] = await redimensionarImagem(imgInput.files[0], 128);
        renderAxisList(); renderRadar(); commit();
      } catch(_) { alert('Não consegui ler essa imagem.'); }
    };
    imgBtn.appendChild(imgInput);

    // Remover imagem (✕img) — só se houver imagem
    const imgRm = document.createElement('button');
    imgRm.className = 'btn-rm'; imgRm.textContent = '🚫'; imgRm.title = 'Remover imagem';
    imgRm.draggable = false;
    imgRm.style.display = (modoLabel === 'custom' && eixosImagens[i]) ? '' : 'none';
    imgRm.onclick = () => { eixosImagens[i] = null; renderAxisList(); renderRadar(); commit(); };

    // Slider de tamanho individual
    const size = document.createElement('input');
    size.type = 'range'; size.className = 'axis-size';
    size.min = '0.5'; size.max = '2'; size.step = '0.1';
    size.value = String(eixosTamanho[i] || 1);
    size.title = 'Tamanho deste rótulo';
    size.draggable = false;
    size.style.display = modoLabel === 'custom' ? '' : 'none';
    size.oninput = () => { eixosTamanho[i] = parseFloat(size.value); renderRadar(); };
    size.onchange = () => commit(); // grava no histórico só ao soltar
```

E trocar a linha de append:

```js
    row.append(handle, num, sel, inp, imgBtn, imgRm, size, rm);
```

- [ ] **Step 3: Atualizar o remover-eixo para manter arrays alinhados**

Na ação `rm.onclick` e nas operações de drop/reorder de `renderAxisList`, trocar os `splice` que mexem só em `eixos` por operações que mexem também em `eixosLabels/eixosImagens/eixosTamanho`. Para o remover:

```js
    rm.onclick = () => {
      eixos.splice(i,1); eixosLabels.splice(i,1); eixosImagens.splice(i,1); eixosTamanho.splice(i,1);
      renderAxisList(); renderRadar(); renderCards(); commit();
    };
```

Para o reorder (no handler `drop`), substituir o bloco que faz `eixos.splice(from,1)` + `eixos.splice(to,0,item)` por:

```js
      moverParalelo({eixos, eixosLabels, eixosImagens, eixosTamanho}, from, to);
      dragSrcIndex = null;
      renderAxisList(); renderRadar(); renderCards(); commit();
```

(o ajuste `if (from < to) to--` deve ser feito ANTES de chamar `moverParalelo`).

E em `addEixo()`: após `eixos.push(nova)`, chamar `sincronizarArraysEixos()` e `commit()`.

- [ ] **Step 4: CSS dos novos controles**

No `<style>`, adicionar:

```css
.axis-img-btn { cursor:pointer; font-size:13px; padding:0 2px; user-select:none; flex-shrink:0; }
.axis-size { width:54px; accent-color: var(--g700); flex-shrink:0; }
.axis-label-input { flex:1; min-width:40px; }
```

- [ ] **Step 5: Verificar manualmente e commit**

No app (modo Custom): subir um PNG num eixo → some o texto, botão vira 🖼️*; 🚫 remove; slider muda o tamanho na hora. Reordenar e remover eixos mantém imagem/tamanho colados ao eixo certo.

```bash
iconv -f UTF-8 -t UTF-8 ~/Documents/radar-copa/index.html >/dev/null && echo OK
git -C ~/Documents/radar-copa add index.html
git -C ~/Documents/radar-copa commit -m "UI lateral: imagem PNG, remover imagem e tamanho por eixo"
```

---

### Task 4: Renderizar imagem + tamanho individual na tela

**Files:**
- Modify: `index.html` — `pluginLabelsCustom.afterDraw` (~824) e o caminho de rótulos não-curvos (Chart `pointLabels`)

**Interfaces:**
- Consumes: `eixosImagens`, `eixosTamanho`, `getPosicoesRotulos` (~1493).
- Produces: `imgCache` (Map dataURL→HTMLImageElement) e `getImg(dataURL)` (carrega/cacheia).

- [ ] **Step 1: Cache de imagens**

```js
const imgCache = new Map();
function getImg(dataURL) {
  if (!dataURL) return null;
  let im = imgCache.get(dataURL);
  if (!im) { im = new Image(); im.src = dataURL; imgCache.set(dataURL, im); }
  return im;
}
```

- [ ] **Step 2: Desenhar imagens/escala no canvas (afterDraw)**

Estender o plugin `pluginLabelsCustom` (ou adicionar um segundo plugin `pluginImagensEixos`) com um `afterDraw` que, para cada eixo `i` com `eixosImagens[i]`, desenha a imagem na posição do rótulo:

```js
const pluginImagensEixos = {
  id: 'imagensEixos',
  afterDraw(chart) {
    const r = chart.scales.r; if (!r) return;
    const n = eixos.length;
    for (let i = 0; i < n; i++) {
      const data = eixosImagens[i];
      if (!data) continue;
      const im = getImg(data); if (!im.complete || !im.naturalWidth) continue;
      const ang = (2*Math.PI*i/n) - Math.PI/2;
      const rad = r.drawingArea + 26;
      const cx = r.xCenter + rad*Math.cos(ang);
      const cy = r.yCenter + rad*Math.sin(ang);
      const base = Math.max(22, r.drawingArea/9) * (eixosTamanho[i] || 1);
      const escala = base / Math.max(im.naturalWidth, im.naturalHeight);
      const w = im.naturalWidth*escala, h = im.naturalHeight*escala;
      chart.ctx.drawImage(im, cx - w/2, cy - h/2, w, h);
    }
  }
};
Chart.register(pluginImagensEixos);
```

Quando a imagem ainda não terminou de carregar (`!im.complete`), agendar um `renderRadar()` no `im.onload` (definir no `getImg`).

- [ ] **Step 3: Esconder o pointLabel/texto onde há imagem**

Em `getLabelsExibicao`, retornar string vazia para eixos com imagem (para não desenhar texto embaixo da imagem):

```js
    if (eixosImagens[i]) return '';
```

(no início do `.map`, antes de calcular `label`).

Para o tamanho individual do TEXTO no modo não-curvo, como o Chart.js usa um `font` único em `pointLabels`, aplicar a escala via callback `font: (c) => ({ size: baseSize * (eixosTamanho[c.index]||1), ... })` na configuração da escala `r.pointLabels` em `renderRadar`.

- [ ] **Step 4: Verificar manualmente e commit**

Subir imagens em 1–2 eixos e mudar tamanhos: aparecem no radar na tela, no lugar do texto, com o tamanho certo; demais eixos intactos.

```bash
iconv -f UTF-8 -t UTF-8 ~/Documents/radar-copa/index.html >/dev/null && echo OK
git -C ~/Documents/radar-copa add index.html
git -C ~/Documents/radar-copa commit -m "Render de imagem e tamanho individual dos rótulos na tela"
```

---

### Task 5: Edição inline do rótulo (duplo-clique no gráfico)

**Files:**
- Modify: `index.html` — `configurarDragRadar` (~1532) ou novo handler; CSS

**Interfaces:**
- Consumes: `rotuloMaisProximo`, `getPosicoesRotulos`, `eixosLabels`, `commit`, `renderRadar`.

- [ ] **Step 1: Handler de duplo-clique**

Dentro de `configurarDragRadar`, após configurar os listeners existentes, adicionar:

```js
  canvas.addEventListener('dblclick', ev => {
    const { x, y } = coordsCanvas(ev);
    const idx = rotuloMaisProximo(x, y, 45);
    if (idx === null) return;
    if (modoLabel !== 'custom') { setModoLabel('custom'); }
    const pos = getPosicoesRotulos().find(p => p.idx === idx);
    abrirEditorInline(idx, pos);
  });
```

- [ ] **Step 2: Editor flutuante**

```js
function abrirEditorInline(idx, pos) {
  const wrap = document.getElementById('chartWrap');
  const ed = document.createElement('input');
  ed.type = 'text'; ed.className = 'inline-editor';
  ed.value = eixosLabels[idx] || eixos[idx] || '';
  ed.style.left = pos.x + 'px';
  ed.style.top  = pos.y + 'px';
  const commitEd = () => {
    eixosLabels[idx] = ed.value;
    if (ed.parentNode) ed.parentNode.removeChild(ed);
    renderAxisList(); renderRadar(); commit();
  };
  ed.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commitEd(); }
    else if (e.key === 'Escape') { if (ed.parentNode) ed.parentNode.removeChild(ed); }
  };
  ed.onblur = commitEd;
  wrap.appendChild(ed);
  ed.focus(); ed.select();
}
```

- [ ] **Step 3: CSS do editor + hint**

```css
.inline-editor {
  position:absolute; transform:translate(-50%,-50%); z-index:20;
  width:130px; padding:4px 6px; font-size:13px; text-align:center;
  border:2px solid var(--g500); border-radius:6px; background:#fff;
  box-shadow:0 4px 14px rgba(0,0,0,.18);
}
```

Atualizar o texto do `#dragHint` para: "Arraste um rótulo para reordenar · duplo-clique para editar".

- [ ] **Step 4: Verificar manualmente e commit**

Duplo-clique num rótulo do radar → caixa abre sobre ele; Enter confirma (some o texto antigo, entra o novo, lista lateral atualiza); Esc cancela; arrastar ainda reordena.

```bash
iconv -f UTF-8 -t UTF-8 ~/Documents/radar-copa/index.html >/dev/null && echo OK
git -C ~/Documents/radar-copa add index.html
git -C ~/Documents/radar-copa commit -m "Edição inline do rótulo por duplo-clique no gráfico"
```

---

### Task 6: Desfazer / Refazer — botões + atalhos

**Files:**
- Modify: `index.html` — HTML da `top-actions` (~593), CSS, `keydown` handler, `atualizarBotoesHistorico`

**Interfaces:**
- Consumes: `HIST`, `histUndo`, `histRedo`, `podeDesfazer`, `podeRefazer`, `aplicarSnapshot`.
- Produces: `desfazer()`, `refazer()`, `aplicarSnapshot(snap)`, `atualizarBotoesHistorico()` (substitui o stub da Task 2).

- [ ] **Step 1: Botões na barra de ações**

No `<div class="top-actions">`, como PRIMEIROS filhos:

```html
      <button class="btn-dl btn-hist" id="btnUndo" title="Desfazer (Ctrl+Z)" onclick="desfazer()">↶</button>
      <button class="btn-dl btn-hist" id="btnRedo" title="Refazer (Ctrl+Shift+Z)" onclick="refazer()">↷</button>
```

CSS:

```css
.btn-hist { background:#6B7280; padding:8px 12px; font-size:15px; line-height:1; }
.btn-hist:disabled { opacity:.35; cursor:not-allowed; }
```

- [ ] **Step 2: aplicarSnapshot + desfazer/refazer + atualizar botões**

```js
function aplicarSnapshot(snap) {
  if (!snap) return;
  const c = JSON.parse(JSON.stringify(snap));
  eixos = c.eixos; eixosLabels = c.eixosLabels;
  eixosImagens = c.eixosImagens; eixosTamanho = c.eixosTamanho;
  temaAtual = c.tema; modoLabel = c.modoLabel;
  document.getElementById('cLinha').value = c.cLinha;
  document.getElementById('cFundo').value = c.cFundo;
  document.getElementById('rOpacity').value = c.opacidade;
  document.getElementById('rEsp').value = c.espessura;
  document.getElementById('rPt').value = c.ponto;
  salvarConfig();                 // persiste o estado restaurado
  renderAxisList(); renderRadar(); renderCards();
}
function desfazer() { const s = histUndo(HIST); if (s) { aplicarSnapshot(s); atualizarBotoesHistorico(); } }
function refazer() { const s = histRedo(HIST); if (s) { aplicarSnapshot(s); atualizarBotoesHistorico(); } }
```

Substituir o stub `atualizarBotoesHistorico` por:

```js
function atualizarBotoesHistorico() {
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if (u) u.disabled = !podeDesfazer(HIST);
  if (r) r.disabled = !podeRefazer(HIST);
}
```

**Importante:** `desfazer/refazer` NÃO chamam `commit()` (senão empilhariam de novo). Eles só movem o ponteiro e reaplicam.

- [ ] **Step 3: Atalhos de teclado**

No handler de `keydown` existente, ANTES do `return` que ignora quando o foco está em INPUT/TEXTAREA/SELECT, tratar os atalhos globais de histórico (para funcionarem mesmo fora de inputs; quando dentro de input, deixa o desfazer nativo):

```js
  const emCampo = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !emCampo) {
    e.preventDefault();
    if (e.shiftKey) refazer(); else desfazer();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !emCampo) {
    e.preventDefault(); refazer(); return;
  }
```

- [ ] **Step 4: Garantir commit() em toda ação mutadora**

Conferir que estas chamam `commit()` (algumas já passaram a chamar nas tasks anteriores): editar texto do eixo (no `inp.oninput`, usar debounce simples — chamar `commit()` no `inp.onchange`), trocar coluna do eixo (`sel.onchange`), `aplicarTema`, mudanças de cor/opacidade/espessura/ponto (nos `oninput`/`onchange` dos controles de design → no `onchange` chamar `commit()`), `restaurarOrdemNarrativa`, toggles de camadas. Onde hoje chamam `salvarConfig()`, trocar por `commit()` (que já chama `salvarConfig`).

- [ ] **Step 5: Verificar manualmente e commit**

Fazer várias edições (texto, imagem, tamanho, tema, reordenar). Ctrl+Z desfaz uma a uma; Ctrl+Shift+Z refaz; botões ↶/↷ idem e ficam esmaecidos nos extremos. Ctrl+Z digitando num campo NÃO dispara o desfazer do app.

```bash
iconv -f UTF-8 -t UTF-8 ~/Documents/radar-copa/index.html >/dev/null && echo OK
git -C ~/Documents/radar-copa add index.html
git -C ~/Documents/radar-copa commit -m "Desfazer/refazer: botões ↶/↷ e atalhos Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y"
```

---

### Task 7: Consistência nos PNGs exportados (Estúdio + Lote)

**Files:**
- Modify: `index.html` — `comporRadarPNG` (~1765)

**Interfaces:**
- Consumes: `eixosImagens`, `eixosTamanho`.
- Produces: `precarregarImagens(dataURLs)` → `Promise<Map>` (Image carregadas).

- [ ] **Step 1: Pré-carregar imagens antes de compor**

```js
function precarregarImagens(lista) {
  return Promise.all(lista.map(d => d ? new Promise(res => {
    const im = new Image(); im.onload = () => res([d, im]); im.onerror = () => res(null); im.src = d;
  }) : Promise.resolve(null))).then(pares => new Map(pares.filter(Boolean)));
}
```

No início de `comporRadarPNG` (que já é `async`), antes de desenhar os rótulos: `const mapImgs = await precarregarImagens(eixosImagens);`

- [ ] **Step 2: Desenhar imagem/tamanho no PNG**

No trecho de `comporRadarPNG` que desenha os rótulos dos eixos (pointLabels/curvos), para cada eixo `i`: se `mapImgs.has(eixosImagens[i])`, desenhar a imagem (centralizada na posição do rótulo, dimensão base × `eixosTamanho[i]`, proporcional ao `tam` do canvas), e NÃO desenhar o texto. Caso contrário, desenhar o texto multiplicando o `fontSize` por `eixosTamanho[i]`. Usar a mesma matemática de posição já existente para os labels naquele bloco (ângulo `i`, raio do rótulo), apenas trocando texto por `drawImage` quando houver imagem.

- [ ] **Step 3: Verificar manualmente (Estúdio e Lote) e commit**

Com imagens e tamanhos definidos: abrir Estúdio → preview e PNG baixado mostram as imagens/tamanhos. Lote → ZIP com vários países mantém as personalizações.

```bash
iconv -f UTF-8 -t UTF-8 ~/Documents/radar-copa/index.html >/dev/null && echo OK
git -C ~/Documents/radar-copa add index.html
git -C ~/Documents/radar-copa commit -m "PNGs (Estúdio/Lote) refletem imagem e tamanho individual dos rótulos"
```

---

### Task 8: Verificação ponta-a-ponta + deploy

**Files:** nenhum (verificação) — depois, publicar.

- [ ] **Step 1: Verificação manual completa**

Usar a skill `verify`: rodar o app, carregar dados, exercitar TODAS as features (inline edit, imagem, tamanho, desfazer/refazer, Estúdio, Lote), conferir consistência tela↔PNG, sem erros de console. Confirmar que modos texto/emoji e o arrastar-reordenar continuam funcionando.

- [ ] **Step 2: Rodar o teste de lógica pura de novo (não regrediu)**

Run: `node ~/Documents/radar-copa/docs/plans/tests/test_helpers.mjs` → `OK: helpers puros`

- [ ] **Step 3: Publicar e confirmar no ar**

```bash
git -C ~/Documents/radar-copa push
```

Depois, monitorar o build do Pages (mesmo padrão das atualizações anteriores: API `pages/builds/latest` + checar HTTP 200 e um marcador do novo código no HTML servido), e confirmar a URL https://proflegeo.github.io/radar-copa/.

---

## Self-Review (cobertura do spec)

- Edição inline (spec §1) → Task 5 ✅
- Imagem PNG (spec §2) → Tasks 3 (UI/storage) + 4 (tela) + 7 (PNG) ✅
- Tamanho individual (spec §3) → Tasks 3 (UI) + 4 (tela) + 7 (PNG) ✅
- Desfazer/Refazer (spec §4) → Tasks 1 (pilha) + 2 (commit) + 6 (UI/atalhos) ✅
- Consistência tela↔PNG (spec §5) → Task 4 + Task 7 ✅
- Persistência + modelo de dados → Task 2 ✅
- Restrições (downscale 128px, quota, não curvar imagem, não quebrar reorder/modos) → Tasks 3, 4, 8 ✅
- Testes (Node puro + verify) → Task 1 + Task 8 ✅
