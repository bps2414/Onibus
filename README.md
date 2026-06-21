# 🚌 BoraBus

O **BoraBus** é um aplicativo web leve e mobile-first projetado para ajudar a prever horários de ônibus com base no seu histórico real de uso. Ele aprende com o tempo, ajustando-se a variações de trânsito, dias da semana e horários específicos.

Tudo é salvo localmente no seu próprio celular ou navegador usando **IndexedDB**, garantindo privacidade total e carregamento instantâneo.

---

## ✨ Funcionalidades Principais

*   **Previsões Inteligentes:** Um motor que aprende com o seu histórico real para prever o horário exato de chegada do ônibus no ponto e quando você chegará ao destino.
*   **Modo Registro Rápido:** Salve os horários reais em tempo real com dois cliques ("Ônibus Chegou" e "Cheguei ao Destino").
*   **Presets Customizados:** Salve suas rotas mais comuns (ex: "Ida para a Escola", "Volta para Casa") para ter acesso rápido na tela inicial.
*   **Estatísticas Detalhadas:** Gráficos interativos que mostram seus tempos de espera, duração da viagem e taxa de confiança das previsões.
*   **Privacidade Máxima:** Nenhum dado é enviado para servidores externos. Tudo fica guardado no banco de dados local do seu navegador (IndexedDB).
*   **Backup e Restauração:** Exporte todos os seus dados e presets para um arquivo JSON para restaurar em outro dispositivo.
*   **Tema Escuro/Claro:** Visual moderno otimizado para economizar bateria e facilitar o uso na rua.

---

## 🚀 Como Rodar o Projeto Localmente

Se você quiser rodar e testar o projeto no seu computador:

1.  **Instale as dependências:**
    ```bash
    npm install
    ```

2.  **Inicie o servidor de desenvolvimento local:**
    ```bash
    npm run dev
    ```

3.  **Acesse o link gerado** no terminal (geralmente `http://localhost:5173`) ou escaneie o código QR gerado para testar diretamente do seu celular na mesma rede Wi-Fi!

---

## ⚡ Como Fazer Deploy na Vercel

O projeto já está configurado e pronto para a Vercel através do seu repositório no GitHub! Siga estes passos simples para colocar seu app no ar gratuitamente:

1.  Acesse o site da [Vercel](https://vercel.com/) e faça login com sua conta do GitHub.
2.  No painel da Vercel, clique no botão **"Add New..."** e selecione **"Project"**.
3.  Você verá uma lista com os seus repositórios do GitHub. Encontre o repositório **`Onibus`** e clique em **"Import"**.
4.  Na tela de configurações:
    *   **Framework Preset:** A Vercel deve detectar automaticamente **Vite**.
    *   Não precisa alterar nenhum comando! O comando de build (`npm run build`) e diretório de saída (`dist`) já estão configurados no seu `package.json`.
5.  Clique em **"Deploy"**.
6.  Em poucos segundos, o seu app estará no ar com um link público (ex: `https://onibus-seu-usuario.vercel.app`) que você poderá acessar e salvar na tela inicial do seu celular!

Toda vez que você atualizar o código e fizer um `git push` no seu GitHub, a Vercel atualizará o seu site publicado automaticamente.

---

## ⚙️ Tecnologias Utilizadas

*   **Vite + TypeScript:** Para um desenvolvimento super rápido e com verificação de erros.
*   **Vanilla CSS:** Interface minimalista, moderna e fluida, sem a necessidade de bibliotecas pesadas.
*   **IndexedDB:** Armazenamento robusto e nativo do navegador para o histórico e presets.
