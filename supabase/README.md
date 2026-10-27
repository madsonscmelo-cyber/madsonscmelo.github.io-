# Raio-X de Alimentadores: banco no Supabase

Estes arquivos levam a base real a um PostgreSQL no Supabase. A leitura exige login e respeita o perfil:

- gerência, planejamento e auditoria veem todos os alimentadores;
- supervisor vê só o próprio conjunto;
- sem login, ninguém vê nada.

O repositório guarda só a **estrutura**. Os dados e as chaves ficam fora dele.

| Arquivo | O que faz |
|---|---|
| `schema.sql` | Cria as tabelas (alimentadores, postes com `pai`, ocorrências, compensações, perfis e auditoria) e as regras de acesso por linha (RLS). Pode rodar de novo sem estragar nada |
| `carregar.mjs` | Lê os mesmos CSV da tela Dados, com a mesma validação linha a linha, e grava no banco em lotes de 1.000. Grava o pai antes do filho, para respeitar a topologia |

## Passo a passo

1. **Criar o projeto** em supabase.com (plano gratuito). Escolha a região São Paulo (`sa-east-1`).
2. **Criar as tabelas.** No painel, abra *SQL Editor*, cole `schema.sql` e clique em *Run*.
3. **Criar os usuários.** Em *Authentication → Users → Add user*, cadastre o e-mail e a senha de cada pessoa. Depois, no SQL Editor, rode uma linha por pessoa:
   ```sql
   insert into public.perfis (user_id, matricula, nome, perfil, conjunto)
   select id, 'G4001', 'Nome da pessoa', 'GESTOR', null from auth.users where email = 'pessoa@empresa.com';
   -- supervisor: perfil 'SUPERVISOR' e conjunto 'CJ Sul' (exatamente como na planilha)
   ```
4. **Carregar a base** na sua máquina. A chave `service_role` nunca vai para o repositório nem para o chat:
   ```bash
   SUPABASE_URL=https://<projeto>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<chave service_role> \
   node supabase/carregar.mjs postes.csv ocorrencias.csv compensacoes.csv --substituir
   ```
   Para eu rodar a carga numa sessão do Claude Code, cadastre as duas variáveis como segredo do ambiente. O caminho é o menu do ambiente no título da sessão, depois *Edit*, depois *Network secrets* (ou *API credentials*, em versões antigas do app).

## Regras de acesso (testadas em PostgreSQL 16)

| Quem | Lê | Altera a base |
|---|---|---|
| Sem login (chave `anon`) | nada (acesso negado) | não |
| Usuário logado sem perfil cadastrado | nada (0 linhas) | não |
| Supervisor | só alimentadores do próprio `conjunto` | não |
| Gerência, planejamento, auditoria | tudo | não |
| Chave `service_role` (só na carga) | tudo | sim |

A auditoria só aceita inclusão de registros. Quem lê o log são gerência e auditoria.

## O que falta no app (próximo passo)

Hoje o app lê a base do aparelho, pelo IndexedDB. Para ler do Supabase, ele precisa de três mudanças:

1. Login pelo Supabase Auth no lugar do login local.
2. Leitura das tabelas com o token do usuário logado.
3. CSP liberando `https://<projeto>.supabase.co`.

A URL do projeto e a chave `anon` podem ficar no código, porque sozinhas não leem nada. A chave `service_role` não pode.
