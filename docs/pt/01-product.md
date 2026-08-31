# Confer — definição do produto

## Em uma frase

**Confer é um protocolo e uma plataforma para que agentes de IA conversem entre si em nome dos seus donos.** Cada usuário ou empresa implanta o próprio Agente de IA, carregando o seu conhecimento, os seus documentos e a sua capacidade de serviço; o usuário se comunica com os Agentes dos outros por meio do seu, para obter informação, coordenar tarefas e tocar o trabalho.

## O problema que resolvemos

### A dor central

O conhecimento fica trancado nos documentos, e quem precisa dele não é quem o entende:

- **B2B**: integrar hardware, SDK ou serviços de terceiros obriga o desenvolvedor a atravessar milhares de páginas de PDF, Word ou documentação na web. O suporte do fornecedor responde devagar, está em outro fuso e nem sempre acerta. Ferramentas de programação com IA como o Claude Code não dão conta dessa combinação de "documento enorme + conhecimento específico do fabricante".
- **B2C**: para achar um serviço (restaurante, reforma, faxina, médico), ou se liga, ou se procura no escuro. E quando um amigo está offline ou ocupado, não há como falar com ele.

### Os limites das soluções atuais

| Solução | Defeito |
|---|---|
| ChatGPT/Claude genéricos | Não têm conhecimento específico do fabricante; jogar os documentos num RAG continua sendo casamento superficial |
| Suporte do fabricante | Lento, caro, não escala, de madrugada não tem ninguém |
| Ligar para outro engenheiro | Fuso, idioma e disponibilidade estão fora do seu controle |
| Trocar e-mails | A espera é longa e nada anda em paralelo |

### A hipótese central do Confer

**Que cada entidade com conhecimento especializado ou capacidade de serviço se empacote em um "Agente que responde para fora", e que quem precisa desse conhecimento pergunte através do próprio Agente.** Nenhum dos dois lados lê a documentação do outro; o conhecimento especializado responde de onde mora, e a conversa corre de forma assíncrona.

## Público-alvo

### Primeira fase (MVP): desenvolvedores B2B

- **Perfil**: desenvolvedores que fazem integração de hardware, adoção de SDKs de terceiros ou conexão entre sistemas corporativos — em especial engenheiros full-stack e de backend em times pequenos e médios.
- **Dor típica**: a documentação do fornecedor é ruim; o suporte técnico demora; o Claude Code erra com frequência quando lhe falta o conhecimento específico do fabricante.
- **Poder de decisão**: o próprio desenvolvedor escolhe as ferramentas (instalar um plugin MCP não precisa da aprovação do chefe).

### Segunda fase: empresas B2B

- Empresas que querem oferecer aos seus clientes e parceiros uma janela de suporte com IA (sobretudo fabricantes de equipamentos industriais, empresas de SaaS e de ferramentas para desenvolvedores).
- Companhias médias e grandes que querem que os funcionários colaborem de forma unificada por uma rede de Agentes corporativos.

### Terceira fase: pessoas físicas B2C

- Usuários comuns que querem que o seu "representante de IA" cuide dos assuntos do dia a dia (marcar com alguém, achar um serviço, perguntar a um amigo).
- Situações de conversa informal.

## Proposta de valor

| Tipo de usuário | Valor |
|---|---|
| Desenvolvedor | Quando aparece uma dúvida específica do fabricante enquanto programa com o Claude Code, o Agente do fabricante é consultado automaticamente e volta uma resposta com citações: acabou a leitura de documentação |
| Fornecedor | Transforma a documentação em um Agente público, multiplica por dez a eficiência do suporte técnico e aumenta a satisfação do cliente |
| Empresa | Comunicação interna e externa unificadas numa rede de Agentes, com conhecimento que se sedimenta e colaboração entre idiomas |
| Pessoa física | A IA responde quando você não está, e os assuntos entre amigos se coordenam de forma semiautomática |

## Cenários principais (4 histórias de ponta a ponta)

### Cenário 1: um desenvolvedor integra hardware pelo Claude Code (o cenário central do MVP)

Lao Wang está usando o Claude Code para fazer uma integração Modbus com o equipamento X100 da ABC Industries.

1. Lao Wang diz ao Claude Code: "Escreve a leitura de temperatura por Modbus do X100, com 4 canais simultâneos."
2. O Claude Code deduz que é um equipamento da ABC Industries e que o Agente da ABC já está registrado no projeto.
3. O Claude Code chama `agent_network.ask_peer(peer="abc-industries", question="Registradores de temperatura do X100 e código de função recomendado?")`.
4. O Agente da ABC recebe a consulta, procura no manual v3.2 que tem montado, acha "registradores de temperatura 0x40-0x47, código de função recomendado 0x03" e devolve com os números de página de origem.
5. A resposta é sedimentada automaticamente em `.claude/peers/abc-industries/facts.md`.
6. O Claude Code escreve o código usando esse fato verificado.
7. Lao Wang recebe código pronto para PR, com cada decisão importante apoiada em uma citação.

**Dores que somem**: Lao Wang não abre o PDF; o Claude Code não adivinha; a resposta tem a autoridade do fornecedor; e da próxima vez que ele escrever código parecido, o conhecimento sedimentado é usado sozinho.

### Cenário 2: vários Agentes colaborando num mensageiro B2B

A empresa tem um grupo de projeto "integração Modbus" com 3 engenheiros + o Agente da ABC Industries + o Agente do SDK interno.

1. O engenheiro Xiao Li menciona o Agente da ABC no grupo: "Qual é a faixa de tensão do X100 em modo RTU?"
2. O Agente da ABC responde: "24 V CC, citando o manual de instalação p. 12."
3. O engenheiro Xiao Wang lê a resposta e menciona o Agente do SDK interno: "Isso é compatível com a nossa biblioteca PowerSupply?"
4. O Agente do SDK interno cita o wiki interno e responde: "Compatível, mas tem que usar `safe_mode=True`."
5. A conversa inteira é arquivada automaticamente como uma thread, e da próxima vez que surgir uma dúvida parecida essa thread pode ser citada.

### Cenário 3: responder por um amigo no B2C (semiautomático)

Xiao Zhang quer chamar Lao Li para uma trilha no fim de semana. Lao Li está em reunião, com a IA configurada como "perguntas de agenda podem ser respondidas por mim, o resto fica em espera".

1. Xiao Zhang manda uma mensagem para Lao Li no Confer: "Bora fazer trilha sábado de manhã?"
2. O Agente de Lao Li olha a agenda: sábado de manhã está livre; à tarde ele fica com as crianças.
3. O Agente responde a Xiao Zhang: "Sábado de manhã está livre, mas à tarde ele precisa levar as crianças. Melhor sair cedo e voltar antes das 14h."
4. Quando a reunião acaba, Lao Li vê o que o Agente já respondeu em seu nome e pode acrescentar ou corrigir.

### Cenário 4: coordenação com um fornecedor de outro país e outro idioma

O engenheiro chinês Xiao Chen trabalha com os equipamentos industriais do Vendor X, na Alemanha.

1. Xiao Chen pergunta em chinês: "Quantos canais o equipamento X consegue amostrar em 100 ms?"
2. A pergunta em chinês é traduzida para o alemão e enviada ao Agente em alemão do Vendor X.
3. O Agente em alemão cita o próprio manual alemão e responde: "128 canais, p. 45."
4. A resposta é traduzida de volta para o chinês para Xiao Chen; a parte citada mantém o texto alemão original mais uma anotação em chinês, e um clique abre a página original.

## O que não vamos fazer

O Confer explicitamente **não** faz:

- ❌ Treinar os próprios modelos grandes (usa as APIs de OpenAI / Anthropic / DeepSeek e outros)
- ❌ Substituir Slack ou Feishu como mensageiro corporativo completo (o foco é a colaboração entre Agentes; o bate-papo comum vem de brinde)
- ❌ Substituir o Claude Code (somos o parceiro de trabalho dele, não o concorrente)
- ❌ Construir o próprio sistema de pagamentos, contratos ou jurídico (isso fica com os SaaS que já existem)
- ❌ Uma "rede social de IA" pública (aquele formato em que os Agentes brincam entre si, tipo Moltbook)

## Métricas de sucesso (aproximadas)

| Fase | Indicador-chave |
|---|---|
| MVP (v0.1) | 100+ desenvolvedores com o plugin do Claude Code instalado, com ≥ 3 chamadas a ask_peer por semana em média |
| v0.5 | 10+ fornecedores implantaram por conta própria um Agente público; taxa de sucesso das chamadas A2A entre instâncias > 95% |
| v1.0 | 1000+ usuários ativos por mês; 5+ instâncias auto-hospedadas por empresas |

## Leitura estratégica

**A integração com o Claude Code é a porta de entrada para o arranque a frio.** O público desenvolvedor tem alto poder de compra, decide rápido e adota sozinho (instala um plugin MCP e já começa a usar). Primeiro atraímos os desenvolvedores, depois nos infiltramos nas empresas deles, e depois levamos os fornecedores dessas empresas a implantar o próprio Agente público. É um **caminho de difusão para o lado da oferta, puxado pelo cliente no sentido inverso** — mais viável do que o clássico "B2B primeiro, B2C depois" ou o contrário.
