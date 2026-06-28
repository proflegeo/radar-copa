# Rótulos personalizados do radar — Design

**Data:** 2026-06-28
**Arquivo alvo:** `index.html` (app autocontido, single-file)
**Contexto de manutenção:** a partir de agora o `index.html` do repositório é a fonte
oficial. O app deixou de ser regenerado por gerador externo; mudanças são feitas
direto aqui. (Ver memória `env-github-deploy-setup`.)

## Objetivo

Permitir que o usuário personalize os rótulos dos eixos do radar de três formas,
com o resultado idêntico na tela interativa **e** nos PNGs exportados (Estúdio e Lote):

1. **Editar o rótulo direto no gráfico** (duplo-clique no rótulo).
2. **Usar uma imagem PNG no lugar do rótulo** (upload por eixo).
3. **Tamanho individual** por eixo (texto ou imagem).

## Estado atual relevante (já existe no código)

- `modoLabel`: `'texto' | 'emoji' | 'custom'`. No modo custom, `eixosLabels[i]` guarda
  o label customizado de cada eixo, editável pela lista lateral "EIXOS DO RADAR".
- `getLabelsExibicao()` resolve o label exibido por eixo.
- Plugin `pluginLabelsCustom` (afterDraw) desenha rótulos no canvas; já trata emoji
  (posiciona direto) vs. texto (pode curvar).
- `getPosicoesRotulos()` + `rotuloMaisProximo()` + `configurarDragRadar()` já implementam
  arrastar rótulos no canvas para **reordenar** (trocar eixos).
- `comporRadarPNG(opts)` gera o PNG (usado por Estúdio e Lote) com seu próprio
  desenho de rótulos.
- Persistência: `salvarConfig()` / `carregarConfig()` em `localStorage` (`copaConfig`).

## Comportamento detalhado

### 1. Edição inline no gráfico
- Disparo: **duplo-clique** num rótulo (só no modo custom). Um `<input>` flutuante
  é posicionado sobre o rótulo; Enter confirma, Esc cancela, blur confirma.
- Convive com o arrasto existente: um arrasto (mousedown+move) reordena; duplo-clique edita.
- Ao confirmar, grava em `eixosLabels[i]`, troca `modoLabel` para `'custom'` se preciso,
  salva e re-renderiza. Um hint discreto no topo explica ("duplo-clique edita, arraste reordena").

### 2. Imagem PNG no lugar do rótulo
- Cada linha da lista lateral de eixos ganha um botão **🖼️** (file input `accept=".png,.jpg,.jpeg"`)
  e um **✕** para remover.
- Ao escolher: a imagem é **redimensionada** para no máx. 128px (lado maior) num canvas,
  exportada como dataURL e guardada em `eixosImagens[i]` (string dataURL ou null).
- Render: tanto no plugin de tela quanto em `comporRadarPNG`, se `eixosImagens[i]` existe,
  desenha a imagem (via `Image`/`drawImage`) centralizada na posição do rótulo, no lugar do texto.
- Remover (✕) volta o eixo ao texto/emoji.

### 3. Tamanho individual
- Cada linha da lista ganha um mini-slider de escala (`eixosTamanho[i]`, fator ex.: 0.5–2.0,
  padrão 1.0). Aplica ao texto (multiplica o fontSize calculado) e à imagem (multiplica o
  tamanho base de desenho).
- Botão "restaurar tamanho padrão" zera todos para 1.0.

### 4. Consistência tela ↔ PNG
- A mesma fonte de verdade (`eixosLabels`, `eixosImagens`, `eixosTamanho`) é lida pelos dois
  caminhos de desenho: o plugin de canvas da tela e `comporRadarPNG`.
- Imagens em PNG export: como `drawImage` precisa da imagem carregada, pré-carregar os
  `Image` objects (Promise) antes de compor o PNG (o Estúdio/Lote já são async).

## Modelo de dados (persistido em copaConfig)

```
eixosLabels:  string[]   // texto custom por eixo (já existe)
eixosImagens: (string|null)[]  // dataURL PNG por eixo, ou null  (novo)
eixosTamanho: number[]   // fator de escala por eixo, padrão 1.0  (novo)
```
Índices alinham com `eixos[]`. Ao adicionar/remover/reordenar eixos, os três arrays
acompanham a operação.

## Restrições / riscos

- **localStorage ~5 MB**: por isso o downscale para 128px. Se `salvarConfig()` lançar
  (quota), mostrar aviso amigável e manter as imagens só na sessão atual (não persistir).
- Emojis no canvas não curvam bem (já tratado); imagens nunca curvam — sempre posição direta.
- Não quebrar o arrasto-para-reordenar nem os modos texto/emoji existentes.

## Fora de escopo (YAGNI)

- Biblioteca de ícones pré-prontos (só upload do usuário).
- Reposicionar/rotacionar a imagem livremente (só centralizada na posição do eixo).
- Sincronização em nuvem das imagens (continua local).

## Testes

- Repro/lógica isolada em Node para a resolução de label (texto/emoji/imagem/tamanho),
  no espírito do teste já usado para o bug da Demografia.
- Verificação manual no app (carregar dados de exemplo, editar inline, subir PNG,
  mudar tamanho, exportar Estúdio e Lote, conferir consistência) — via skill `verify`.
