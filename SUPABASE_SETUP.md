# Configuração do login e das permissões

Este site usa o Supabase para autenticação e base de dados. O URL e a chave pública do projeto são necessários para o site funcionar; sem eles, o formulário de acesso fica desativado.

## 1. Criar e configurar o projeto

1. Crie um projeto em [supabase.com](https://supabase.com/).
2. No painel do projeto, abra o **SQL Editor**, copie o conteúdo atualizado de `supabase-schema.sql` e execute-o. Se já executou uma versão anterior, execute novamente para criar o registo de chamadas e as respetivas permissões.
3. Em **Authentication → Sign In / Providers**, mantenha **Email** ativo. Desative **Anonymous Sign-Ins** e os registos públicos: as contas dos utilizadores serão criadas previamente pelo administrador.
4. Copie o URL do projeto e a chave pública (publishable/anon) nas definições da API.
5. Abra `supabase-config.js` e preencha o URL e a chave pública do projeto:

   ```js
   window.CONTACTS_CONFIG = {
     supabaseUrl: "https://o-seu-projeto.supabase.co",
     supabaseAnonKey: "a-sua-chave-publica"
   };
   ```

   A chave publishable/anon foi concebida para ser usada no navegador; nunca coloque a chave `service_role` ou outra chave secreta no site.

## 2. Criar o administrador e as 23 contas

1. Em **Authentication → Users**, crie a conta do administrador com o email e a palavra-passe reais.
2. No SQL Editor do Supabase, atribua o perfil de administrador a esse email:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'o-seu-email@exemplo.pt';
   ```

3. Em **Authentication → Users**, crie cada conta de utilizador com um alias interno no campo Email e uma palavra-passe inicial. O site converte o nome para minúsculas, remove acentos e substitui espaços/sinais por pontos. Exemplo: `João Silva` corresponde a `joao.silva@members.invalid`. Marque a conta como confirmada. Esse alias não é um email real e não recebe mensagens.
4. Distribua cada palavra-passe à respetiva pessoa. Se alguém a esquecer, o administrador terá de repô-la no painel Supabase; não há recuperação por email.
5. Inicie o site num servidor local (por exemplo, a extensão **Live Server** do VS Code ou `python -m http.server 8000`). No único formulário de acesso, utilizadores entram com o nome e administradores com o email; o site encaminha cada conta para a área correta.

Os utilizadores entram com o nome e a palavra-passe definidos pelo administrador; não precisam de fornecer email nem telefone. Mantém os 23 nomes distintos, porque acentos e sinais são removidos ao criar o alias. Com os registos públicos desativados, só as contas criadas previamente podem entrar. Os administradores usam o email e a palavra-passe da sua conta no mesmo formulário; o site encaminha cada perfil automaticamente.

## 3. Executar

Sirva os ficheiros por HTTP, em vez de abrir `index.html` diretamente como `file://`. Por exemplo:

```powershell
python -m http.server 8000
```

Depois abra `http://localhost:8000`. Em produção, publique os ficheiros num alojamento estático com HTTPS e adicione o domínio às URLs autorizadas em **Authentication → URL Configuration** no Supabase.

## Permissões

- **Utilizador:** entra com nome e palavra-passe, vê e pesquisa a lista partilhada, liga para os números, abre SMS e consulta o seu registo de chamadas.
- **Administrador:** pode adicionar, editar e apagar contactos, e promover ou rebaixar contas.
- As permissões são verificadas também na base de dados através de Row Level Security; esconder botões na página não é a única proteção.
- Cada contacto tem um ano atribuído e a lista é agrupada do ano mais antigo para o mais recente. Volte a executar `supabase-schema.sql` no SQL Editor para adicionar a coluna; contactos existentes ficam em “Ano por atribuir” até serem editados pelo administrador.

## Registo e lembretes de chamadas

Ao tocar no ícone do telefone, a tentativa fica associada à conta com sessão iniciada e o telemóvel abre a chamada. O site não consegue detetar se a outra pessoa atendeu; ao voltar ao site, o utilizador expande o contacto, escolhe ✓ ou × e pode guardar observações para essa chamada. O histórico e os lembretes desse contacto aparecem na mesma área expandida. Se escolher ×, a base de dados calcula o lembrete para 15 minutos depois dessa escolha. A caixa antes do contacto é partilhada: ao marcá-la, todos veem a inicial do utilizador que a marcou; desmarcar limpa a indicação, e a marcação seguinte passa a mostrar a nova inicial. Execute a versão atualizada de `supabase-schema.sql` no SQL Editor para ativar a caixa partilhada e atualizar a função que guarda resultados e observações.

Os lembretes são internos ao site: se este estiver fechado à hora marcada, aparecem quando o utilizador voltar a abri-lo. O ícone de mensagem abre a aplicação de SMS do dispositivo, quando suportada.
