# Publicar versão nova

Qualquer IA que altere `monitor-sbc.user.js` publica a versão antes de encerrar.

1. Aumente `// @version` e a constante `VERSION` juntos.
2. Mantenha `@updateURL`, `@downloadURL` e `UPDATE_URL` em `https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js`.
3. Atualize **Versão publicada** no `README.md`.
4. Faça commit e `git push` na branch `main`.

A mesma regra está escrita no topo de `monitor-sbc.user.js`.
