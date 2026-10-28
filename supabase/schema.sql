-- Raio-X de Alimentadores — banco no Supabase (PostgreSQL).
-- Rodar uma vez no SQL Editor do projeto. Nenhum dado aqui: só estrutura e regras de acesso.
-- Regra de ouro: a base real só é lida por usuário autenticado (Supabase Auth) e cadastrado em public.perfis.
-- A chave anon (pública) sozinha não lê nada: sem login válido, as políticas abaixo devolvem zero linhas.

create table if not exists public.perfis (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  matricula text not null unique,
  nome      text not null,
  perfil    text not null check (perfil in ('GESTOR', 'ANALISTA', 'SUPERVISOR', 'AUDITOR')),
  conjunto  text,              -- supervisor enxerga só o próprio conjunto; nulo = todos
  ativo     boolean not null default true
);

create table if not exists public.alimentadores (
  id       text primary key,
  nome     text not null,
  conjunto text not null,
  se       text,
  tipo     text
);

create table if not exists public.postes (
  id             text primary key,          -- "<alimentador>|<código do poste>"
  cod            text not null,
  al             text not null references public.alimentadores (id) on delete cascade,
  pai            text references public.postes (id) deferrable initially deferred,
  lat            double precision not null check (lat between -34 and 6),
  lon            double precision not null check (lon between -74 and -28),
  veg            smallint not null default 0 check (veg in (0, 1)),
  acesso         text not null default '' check (acesso in ('', 'DIFICIL')),
  acesso_motivo  text not null default '',
  chave          text not null default '' check (chave in ('', 'DJ', 'RL', 'CS', 'CF', 'NA')),
  trafo          text not null default '',
  ucs            integer not null default 0 check (ucs >= 0)
);
create index if not exists postes_al on public.postes (al);

create table if not exists public.ocorrencias (
  id     text primary key,
  al     text not null references public.alimentadores (id) on delete cascade,
  poste  text references public.postes (id) on delete cascade,   -- nulo = origem não identificada (conta só no alimentador)
  data   timestamp not null,
  causa  text not null check (causa in ('VEG', 'DESC', 'EQUIP', 'ANIMAL', 'TERCEIRO', 'CLIMA', 'PROG', 'OUTRA')),
  ucs    integer not null check (ucs > 0),
  dur    numeric(8, 2) not null check (dur > 0 and dur <= 240),
  chi    numeric(14, 1) not null,
  disp   text
);
create index if not exists ocorrencias_al_data on public.ocorrencias (al, data);

create table if not exists public.compensacoes (
  id     bigint generated always as identity primary key,
  al     text not null references public.alimentadores (id) on delete cascade,
  poste  text references public.postes (id) on delete cascade,   -- nulo = compensação do alimentador sem trafo identificado
  mes    text not null check (mes ~ '^\d{4}-(0\d|1[0-2])$'),   -- AAAA-MM, ou AAAA-00 para valor anual
  valor  numeric(14, 2) not null check (valor > 0)
);
create index if not exists compensacoes_poste on public.compensacoes (poste);

-- Log de leitura e carga (só inclusão).
create table if not exists public.auditoria (
  id         bigint generated always as identity primary key,
  em         timestamptz not null default now(),
  user_id    uuid default auth.uid(),
  acao       text not null,
  detalhe    jsonb not null default '{}'::jsonb
);

-- ---------------- Funções de apoio às políticas ----------------
create or replace function public.meu_perfil() returns public.perfis
language sql stable security definer set search_path = public as
$$ select * from public.perfis where user_id = auth.uid() and ativo $$;

create or replace function public.pode_ver_alimentador(al_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis p join public.alimentadores a on a.id = al_id
    where p.user_id = auth.uid() and p.ativo
      and (p.perfil in ('GESTOR', 'ANALISTA', 'AUDITOR') or p.conjunto is null or p.conjunto = a.conjunto)
  ) $$;

-- ---------------- Row Level Security ----------------
alter table public.perfis        enable row level security;
alter table public.alimentadores enable row level security;
alter table public.postes        enable row level security;
alter table public.ocorrencias   enable row level security;
alter table public.compensacoes  enable row level security;
alter table public.auditoria     enable row level security;

drop policy if exists perfis_proprio on public.perfis;
create policy perfis_proprio on public.perfis for select to authenticated using (user_id = auth.uid());

drop policy if exists al_ler on public.alimentadores;
create policy al_ler on public.alimentadores for select to authenticated using (public.pode_ver_alimentador(id));
drop policy if exists postes_ler on public.postes;
create policy postes_ler on public.postes for select to authenticated using (public.pode_ver_alimentador(al));
drop policy if exists oc_ler on public.ocorrencias;
create policy oc_ler on public.ocorrencias for select to authenticated using (public.pode_ver_alimentador(al));
drop policy if exists comp_ler on public.compensacoes;
create policy comp_ler on public.compensacoes for select to authenticated using (public.pode_ver_alimentador(al));

drop policy if exists aud_incluir on public.auditoria;
create policy aud_incluir on public.auditoria for insert to authenticated with check (user_id = auth.uid());
drop policy if exists aud_ler on public.auditoria;
create policy aud_ler on public.auditoria for select to authenticated using ((public.meu_perfil()).perfil in ('GESTOR', 'AUDITOR'));

-- Escrita na base (carga) só pela chave service_role, que ignora RLS e nunca vai para o navegador nem para o repositório.
-- Nenhuma política de insert/update/delete para "authenticated" nas tabelas da rede = ninguém altera a base pelo app.
revoke all on public.alimentadores, public.postes, public.ocorrencias, public.compensacoes from anon;
revoke all on public.perfis, public.auditoria from anon;
