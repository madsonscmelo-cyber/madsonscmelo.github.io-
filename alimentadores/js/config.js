// Modo de operação. 'demo' = dados sintéticos no próprio aparelho.
// Qualquer outro modo exige API configurada; sem ela o app NÃO inicia (checklist de segurança 6.7: nunca cair em demo silenciosamente).
export const CONFIG = Object.freeze({
  modo: 'demo',
  apiUrl: null,
  // Base pública do Setor Norte (mesmo site, só leitura). O app baixa a UTD escolhida ao abrir. null = só demonstração.
  basePublica: '/campo-mais/raiox/app/app.json',
});

export function validarConfig() {
  if (CONFIG.modo !== 'demo' && !CONFIG.apiUrl) throw new Error('Configuração de produção ausente (apiUrl).');
}
