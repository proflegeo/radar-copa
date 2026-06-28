import { readFileSync } from 'node:fs';
import assert from 'node:assert';

// Extrai o bloco de helpers puros do index.html (fonte única da verdade)
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ ===PURE-HELPERS-START===([\s\S]*?)\/\/ ===PURE-HELPERS-END===/);
assert(m, 'Bloco PURE-HELPERS não encontrado no index.html');
const mod = {};
new Function('exports', m[1] + '\nexports.moverParalelo=moverParalelo;exports.histPush=histPush;exports.histUndo=histUndo;exports.histRedo=histRedo;exports.podeDesfazer=podeDesfazer;exports.podeRefazer=podeRefazer;exports.parseNumOuNull=parseNumOuNull;exports.escapeHtml=escapeHtml;exports.acharColScore=acharColScore;exports.unicizarNomes=unicizarNomes;')(mod);

// parseNumOuNull: vazio/não-numérico => null; números (com vírgula) => number
assert.strictEqual(mod.parseNumOuNull(''), null);
assert.strictEqual(mod.parseNumOuNull('  '), null);
assert.strictEqual(mod.parseNumOuNull('N/D'), null);
assert.strictEqual(mod.parseNumOuNull('-'), null);
assert.strictEqual(mod.parseNumOuNull(undefined), null);
assert.strictEqual(mod.parseNumOuNull('42'), 42);
assert.strictEqual(mod.parseNumOuNull('3,5'), 3.5);
assert.strictEqual(mod.parseNumOuNull(0), 0);

// escapeHtml: caracteres perigosos viram entidades
assert.strictEqual(mod.escapeHtml('a"b<c>&\''), 'a&quot;b&lt;c&gt;&amp;&#39;');
assert.strictEqual(mod.escapeHtml(null), '');

// acharColScore: estrito, não casa 'Média de chuvas'
assert.strictEqual(mod.acharColScore(['País','Média de chuvas','Economia']), null);
assert.strictEqual(mod.acharColScore(['País','Economia','Média Geral']), 'Média Geral');
assert.strictEqual(mod.acharColScore(['País','Score','X']), 'Score');

// unicizarNomes: duplicados ganham sufixo
assert.deepStrictEqual(mod.unicizarNomes(['Brasil','Argentina','Brasil','Brasil']),
  ['Brasil','Argentina','Brasil (2)','Brasil (3)']);

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
