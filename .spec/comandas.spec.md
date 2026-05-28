# Especificação do Sistema de Comandas

## Visão Geral

O sistema de comandas é uma aplicação web para gerenciamento de pedidos em estabelecimentos como bares e restaurantes. Ele permite que usuários com diferentes níveis de acesso (Atendente, Gerente) gerenciem comandas, produtos, categorias, formas de pagamento e relatórios diários.

## Módulos e Funcionalidades Principais

### 1. Autenticação

*   **Login:** Usuários (Atendentes e Gerentes) fazem login com **email** e senha (Supabase Auth).
    *   **Roles:**
        *   `Atendente`: Pode criar, editar e finalizar comandas, e visualizar o dashboard.
        *   `Gerente`: Pode realizar todas as ações de um Atendente, além de acessar as configurações do sistema (produtos, categorias, pagamentos, reabertura de comandas) e relatórios detalhados.
*   **Logout:** Os usuários podem sair do sistema.
*   **Biometria/Último E-mail:** Opção para usar o último e-mail logado.

### 2. Dashboard (Atendente e Gerente)

*   **Resumo Diário:** Exibe:
    *   Vendas do dia.
    *   Comandas ativas (a faturar).
    *   Valor total bruto do dia.
*   **Filtros de Status:** Permite filtrar comandas por status: Todas, Abertas, Finalizadas.
*   **Filtro por Data:** Permite visualizar o dashboard para uma data específica.
*   **Nova Comanda:** Botão para iniciar uma nova comanda.
*   **Lista de Comandas:** Exibe as comandas existentes com informações básicas.

### 3. Gerenciamento de Comandas (Atendente e Gerente)

*   **Criação de Comanda:** Inicia uma nova comanda.
    *   Pode ser associada a uma `Mesa` (se a configuração `useTables` estiver ativa).
    *   Requer o `Nome do Cliente`.
*   **Adicionar Itens à Comanda:**
    *   Busca de produtos por nome.
    *   Filtro de produtos por `Categoria`.
    *   Seleção de produtos e quantidade.
    *   Exibição do subtotal da comanda.
*   **Edição de Itens da Comanda:** (Inferido) Possibilidade de ajustar a quantidade de itens ou remover itens antes da finalização.
*   **Status dos Itens:**
    *   `prepStatus`: Para itens que `requiresPrep: true`, indica o status do preparo (Ex: "Aguardando").
    *   `requestedAt`: Timestamp do pedido do item.
    *   `deliveredAt`: Timestamp da entrega do item.
*   **Cancelamento de Comanda:** Opção para cancelar uma comanda.
*   **Finalização de Comanda (Checkout):**
    *   Exibição do resumo da comanda.
    *   Aplicação de `Taxa de Serviço` (se `useServiceFee` estiver ativa, com valor configurável).
    *   Seleção de `Formas de Pagamento` (PIX, Dinheiro, Cartão, etc.).
    *   Registro do `totalPaid`.

### 4. Relatórios (Gerente)

*   **Seleção de Período:** Define o intervalo de datas para os relatórios.
*   **Tipos de Relatórios:**
    *   Vendas no período (daily).
    *   Faturamento (revenue).
    *   Formas de pagamento (payments).
    *   Itens mais vendidos (products).
    *   Horário de pico (peakHour).
    *   Dia da semana (weekday).
    *   Fechamento de caixa (cashClose) — operação para fechar o caixa aberto.
    *   Fechamentos de caixa (shiftCloses) — histórico por sessão (data de referência = dia da abertura; horários reais de abrir/fechar).
*   **Visualização Detalhada:** Exibe os resultados dos relatórios selecionados.
*   **Histórico de Fechamentos:** Visualiza fechamentos de caixa anteriores.

### 5. Configurações (Gerente)

*   **Cadastro de Produtos:**
    *   Adicionar, editar e remover produtos.
    *   Campos: `Nome`, `Categoria`, `Preço`, `Exige Preparo`.
*   **Operação:**
    *   `Usar número de mesa`: Ativa/desativa o uso de mesas nas comandas.
    *   `Cobrar taxa de serviço`: Ativa/desativa a cobrança de taxa de serviço.
*   **Categorias de Produtos:** Adicionar e remover categorias.
*   **Formas de Pagamento:** Adicionar e remover formas de pagamento, e ativar/desativar existentes.
*   **Tema Visual:** Seleção do tema da interface (Ex: `blue-service`, `dark-pro`, `apple`).
*   **Reabrir Comanda:**
    *   Busca comandas finalizadas ou canceladas em uma data específica.
    *   Permite reabrir comandas, alterando seu status para "Aberta" para edição.

## Estrutura de Dados (Supabase)

Persistência em PostgreSQL via Supabase Auth + PostgREST. Cada usuário autenticado vê apenas seus dados (RLS por `user_id`).

*   **`profiles`** (ligado a `auth.users`): Perfil do usuário logado.
    *   `id`: UUID (`auth.users.id`).
    *   `display_name`: String.
    *   `role`: String ("Atendente", "Gerente").
*   **`products`**: Lista de produtos (colunas + `id` UUID).
    *   `name`: String.
    *   `category`: String.
    *   `price`: Number.
    *   `requiresPrep`: Boolean (opcional, padrão `false`).
*   **`commandas`**: Comandas (`payload` JSONB + colunas `status`, `created_at`, `closed_at`).
    *   `id`: UUID.
    *   `table`: String (número da mesa, pode ser vazio).
    *   `customer`: String (nome do cliente).
    *   `status`: String ("Aberta", "Finalizado", "Cancelada").
    *   `items`: Array de objetos de itens.
        *   `lineId`: String, identificador único para o item na linha.
        *   `productId`: String, referência ao `id` do produto.
        *   `name`: String (nome do produto).
        *   `price`: Number (preço do item no momento do pedido).
        *   `qty`: Number (quantidade).
        *   `requiresPrep`: Boolean.
        *   `requestedAt`: String (ISO 8601 timestamp).
        *   `deliveredAt`: String (ISO 8601 timestamp, pode ser `null`).
        *   `serviceSeconds`: Number (tempo de serviço, pode ser `null`).
        *   `prepStatus`: String ("Aguardando", "Em Preparo", "Pronto", pode ser `null`).
    *   `paymentMethods`: Array de Strings (formas de pagamento usadas).
    *   `serviceFeePercent`: Number (percentual da taxa de serviço).
    *   `totalPaid`: Number (valor total pago).
    *   `createdAt`: String (ISO 8601 timestamp).
    *   `closedAt`: String (ISO 8601 timestamp, pode ser `null`).
    *   `everHadItems`: Boolean.
*   **`daily_closes`**: Fechamentos diários (`payload` JSONB + `date_ymd`, `closed_at`).
    *   `id`: UUID.
    *   `dateYmd`: String (data no formato YYYY-MM-DD).
    *   `closedAt`: String (ISO 8601 timestamp).
    *   `activeOrdersCount`: Number (comandas ativas no momento do fechamento).
    *   `totalBruto`: Number (valor bruto total do dia).
    *   `finalizedOrdersCount`: Number (comandas finalizadas no dia).
    *   `sales`: Array de objetos de vendas.
        *   `orderId`: String, referência ao `id` da comanda.
        *   `customer`: String (nome do cliente).
        *   `totalPaid`: Number.
        *   `paymentMethods`: Array de Strings.
        *   `itemsCount`: Number (total de itens na comanda).
        *   `closedAt`: String (ISO 8601 timestamp).
*   **`shifts`**: Sessões de caixa (abertura e fechamento manuais, sem horário fixo).
    *   `id`: UUID.
    *   `reference_date`: Data de referência do turno (rótulo operacional).
    *   `scheduled_start` / `scheduled_end`: Horários configurados (`time`).
    *   `window_start_at` / `window_end_at`: Intervalo real do turno (`timestamptz`).
    *   `started_at` / `ended_at`: Abertura e fechamento efetivos.
    *   `status`: `"aberto"` | `"fechado"`.
    *   `payload.closeSnapshot`: Resumo ao fechar (vendas, bruto, comandas em aberto).
*   **`commandas.shift_id`**: Comanda finalizada vinculada ao turno.
*   **`app_config`**: Configurações do app (um documento JSON por usuário, chave `user_id`).
    *   `id` (no payload): Number (`1`), referência legada no JSON interno.
    *   `useTables`: Boolean.
    *   `useServiceFee`: Boolean.
    *   `activeTheme`: String (tema visual ativo).
    *   `paymentMethods`: Array de objetos de métodos de pagamento.
        *   `id`: String ("card", "cash", "pix").
        *   `name`: String (nome de exibição).
        *   `active`: Boolean.
    *   `categories`: Array de Strings (categorias de produtos).
    *   `prepCategories`: Array de Strings (categorias que exigem preparo).

## Fluxos de Usuário (Exemplos)

### Fluxo 1: Atendente - Criar e Finalizar Comanda

1.  **Login:** Atendente se autentica.
2.  **Dashboard:** Visualiza o resumo do dia.
3.  **Nova Comanda:** Clica para criar uma nova comanda.
4.  **Detalhe da Comanda:** Informa o nome do cliente (e mesa, se ativado).
5.  **Adicionar Itens:** Pesquisa e adiciona produtos à comanda.
6.  **Confirmar:** Salva os itens na comanda.
7.  **Finalizar Comanda:** Inicia o processo de checkout.
8.  **Checkout:** Aplica taxa de serviço (se ativada), seleciona formas de pagamento e finaliza a comanda.
9.  **Dashboard:** A comanda agora aparece como "Finalizada".

### Fluxo 2: Gerente - Gerenciar Produtos

1.  **Login:** Gerente se autentica.
2.  **Dashboard:** Navega para a aba de "Configurações".
3.  **Configurações de Produtos:** Seleciona a sub-aba "Produtos".
4.  **Adicionar Produto:** Preenche o formulário com `Nome`, `Categoria`, `Preço` e `Exige Preparo`.
5.  **Salvar:** O novo produto é adicionado à lista.
6.  **Editar Produto:** Seleciona um produto existente, edita seus detalhes e salva.
7.  **Remover Produto:** (Inferido) Opção para remover um produto da lista.

### Fluxo 3: Gerente - Visualizar Relatório de Vendas

1.  **Login:** Gerente se autentica.
2.  **Dashboard:** Navega para a aba de "Relatórios".
3.  **Período:** Seleciona o período desejado.
4.  **Tipo de Relatório:** Clica em "Vendas no período".
5.  **Visualização:** O sistema exibe o relatório detalhado de vendas para o período.
