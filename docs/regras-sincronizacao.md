# Regras de sincronização e conflito (para o servidor do piloto)

O app grava tudo no aparelho e envia uma fila de operações quando há rede. Cada operação sobre um defeito leva
`versaoBase` (a versão do defeito que o aparelho conhecia). O servidor compara com a versão atual.

| Situação | Exemplo | Regra |
|---|---|---|
| Sem conflito | `versaoBase` = versão atual | Aplica e incrementa a versão |
| Campo × escritório | Equipe offline registrou **execução**; técnico, antes, **reprogramou** o mesmo defeito | **Execução vale** (fato de campo, com foto e GPS). A reprogramação é descartada e o técnico recebe pendência "reprogramação superada pela execução" |
| Campo × campo | Duas equipes executaram o mesmo defeito | Vale a primeira que chegou ao servidor; a segunda vira **pendência de verificação** para o técnico (possível serviço duplicado — custo) |
| Escritório × escritório | Técnico e gestor reprogramaram ao mesmo tempo | Vale a última; a anterior fica no histórico e no log |
| Cancelamento × execução | Gestor cancelou; equipe executou offline | **Execução vale**; o cancelamento é revertido e registrado com motivo "executado em campo" |
| Ativo avulso | Mesmo ponto cadastrado por duas equipes | Código único por pessoa e instante (`AV-matrícula-carimbo`) evita colisão de código; pontos a menos de 10 m entre si viram pendência de **mesclagem** para o técnico |

Princípios: (1) fato de campo com evidência não é sobrescrito por decisão de escritório; (2) nenhum conflito é resolvido
em silêncio — todo descarte vira pendência ou registro no log; (3) o aparelho mostra o resultado na próxima sincronização.
