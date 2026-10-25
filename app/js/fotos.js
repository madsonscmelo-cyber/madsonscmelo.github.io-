// Captura de evidência: compressão, marca d'água e hash. Recodificar via canvas descarta o EXIF original.
import { el, sha256, toast } from './util.js';
import { salvarFoto, obterFoto, estado } from './store.js';

const LADO_MAX = 1280;

async function processar(arquivo, rotulo) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(arquivo.type)) throw new Error('Formato não suportado');
  if (arquivo.size > 25 * 1024 * 1024) throw new Error('Arquivo maior que 25 MB');
  const bmp = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const p = estado.posicao;
  const linhas = [
    `${rotulo} · ${new Date().toLocaleString('pt-BR')}`,
    p ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}${p.simulada ? ' (simulada)' : ` ±${Math.round(p.precisao || 0)} m`}` : 'Sem posição GPS',
    estado.usuario?.nome || '',
  ];
  const fs = Math.max(14, Math.round(w / 45));
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const alt = fs * 1.35 * linhas.length + fs * 0.6;
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillRect(0, h - alt, w, alt);
  ctx.fillStyle = '#fff';
  linhas.forEach((l, i) => ctx.fillText(l, fs * 0.6, h - alt + fs * 1.3 * (i + 1)));
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.72));
  return { blob, hash: await sha256(blob) };
}

/**
 * Campo de fotos reutilizável. Retorna { elemento, fotos() } — fotos() devolve [{id, hash}].
 * minimo: quantidade obrigatória para salvar.
 */
export function campoFotos({ rotulo, minimo = 1, titulo = 'Fotos' }) {
  const lista = [];
  const miniaturas = el('div', { class: 'fotos__lista' });
  const contador = el('span', { class: 'fotos__contador' });
  const atualizar = () => { contador.textContent = `${lista.length} / mín. ${minimo}`; contador.classList.toggle('ok', lista.length >= minimo); };
  const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, class: 'oculto' });
  input.addEventListener('change', async () => {
    for (const f of input.files) {
      try {
        const { blob, hash } = await processar(f, rotulo());
        const id = await salvarFoto(blob);
        lista.push({ id, hash });
        miniaturas.append(el('img', { src: URL.createObjectURL(blob), alt: 'Foto de evidência', class: 'fotos__mini' }));
      } catch (e) {
        toast(`Foto recusada: ${e.message}`, { tipo: 'erro' });
      }
    }
    input.value = '';
    atualizar();
  });
  atualizar();
  const elemento = el('div', { class: 'campo fotos' },
    el('div', { class: 'fotos__topo' }, el('span', { class: 'campo__rotulo', text: titulo }), contador),
    miniaturas,
    el('button', { type: 'button', class: 'btn btn--sec', text: '📷 Tirar / anexar foto', onclick: () => input.click() }),
    input,
  );
  return { elemento, fotos: () => lista.slice(), suficiente: () => lista.length >= minimo };
}

/** Galeria somente leitura a partir de ids salvos. */
export function galeria(ids = []) {
  const box = el('div', { class: 'fotos__lista' });
  if (!ids.length) box.append(el('span', { class: 'muted', text: 'Sem fotos (registro sintético)' }));
  ids.forEach(async (f) => {
    const blob = await obterFoto(f.id || f);
    if (blob) box.append(el('img', { src: URL.createObjectURL(blob), alt: 'Evidência', class: 'fotos__mini', title: f.hash ? `SHA-256 ${f.hash.slice(0, 16)}…` : '' }));
  });
  return box;
}
