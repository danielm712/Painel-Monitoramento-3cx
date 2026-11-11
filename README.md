# Monitor de SBCs 3CX

Versão publicada: **1.0.8**

## Instalar

Abra o link abaixo no Chrome, com o Tampermonkey instalado, e confirme **Instalar**.

# [Baixar o script](https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js)

O mesmo endereço, para copiar:

`https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js`

## Atualizar depois

No painel do monitor: **Configurações → Verificar atualização**.

O painel baixa o arquivo publicado, compara a versão e responde no próprio painel:

- se não houver novidade, mostra que você já está na mais nova;
- se houver, pergunta **Agora não** ou **Instalar** e só então abre o Tampermonkey.

Depois de confirmar **Atualizar** no Tampermonkey, aplique a versão nova com a mensagem **Para aplicar a nova versão, atualize a página (F5).** O painel não recarrega sozinho. O botão **Atualizar página** faz o mesmo que F5. **Versão atualizada** só aparece quando a página volta já com a versão nova em execução.

Nome dos servidores, histórico, mensagens e a sessão do 3CX permanecem neste navegador.

## Aba Alerta

A aba começa pelo que está acontecendo agora: quantos SBC estão offline e há quanto tempo, só com o nome. Oscilação fica numa linha à parte e não entra nessa conta. **Para enviar** lista só as mensagens ainda não marcadas. As já marcadas vão para **Já enviadas hoje**, inclusive a abertura. Nada é enviado sozinho: **Copiar** aparece com o texto aberto, **Marcar enviado** continua manual, e Esc fecha o texto.

Quem ainda está numa versão anterior à 1.0.2 instala uma vez por este link. A partir daí o botão encontra as próximas versões.

## Publicar uma versão nova

Editar o arquivo no computador não envia nada para este repositório. A versão nova só aparece para os analistas depois que o arquivo `monitor-sbc.user.js` é enviado para a branch `main`, com `@version` e `VERSION` maiores que a versão anterior.
