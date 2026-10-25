// Modo de operação. 'demo' = dados sintéticos no próprio aparelho.
// Qualquer outro modo exige API configurada; sem ela o app NÃO inicia (checklist de segurança 6.7: nunca cair em demo silenciosamente).
export const CONFIG = Object.freeze({
  modo: 'demo',
  apiUrl: null,
  // Retângulo que as importações aceitam. Demonstração: área sintética. Versão local/protegida dos pilotos no norte da
  // Bahia (Juazeiro, Senhor do Bonfim, Jacobina, Remanso): aprox. { latMin: -11.6, latMax: -8.9, lonMin: -42.9, lonMax: -39.6 }.
  areaConcessao: Object.freeze({ latMin: -16.06, latMax: -15.50, lonMin: -48.29, lonMax: -47.31 }),
  mapa: Object.freeze({
    urlTiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribuicao: '&copy; OpenStreetMap',
    // Pacote offline baixa quadros do mapa. No servidor público do OSM isso só é tolerado em demonstração (poucos quadros);
    // em produção exige servidor de mapas próprio ou contratado.
    pacoteOffline: true,
  }),
});
const OSM_PUBLICO = /tile\.openstreetmap\.org/;
export const servidorMapaPublico = () => OSM_PUBLICO.test(CONFIG.mapa.urlTiles);

export function validarConfig() {
  if (CONFIG.modo !== 'demo' && !CONFIG.apiUrl) throw new Error('Configuração de produção ausente (apiUrl).');
  if (CONFIG.modo !== 'demo' && servidorMapaPublico() && CONFIG.mapa.pacoteOffline) throw new Error('Produção com pacote offline exige servidor de mapas próprio (a política do OpenStreetMap público proíbe download em massa).');
}
