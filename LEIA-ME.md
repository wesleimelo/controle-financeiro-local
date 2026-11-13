# Meu Dinheiro: como publicar e usar

## Publicar no GitHub Pages (uma vez, ~5 min)
1. Entre em github.com e toque em **+ > New repository**.
2. Nome: `meu-dinheiro`. Marque **Public** (necessário no plano grátis do Pages). Crie.
3. Toque em **uploading an existing file** e envie TODOS os arquivos desta pasta
   (index.html, style.css, app.js, logic.js, db.js, sw.js, manifest.webmanifest e a pasta icons).
   Dica: é mais fácil fazer isso pelo computador. Depois **Commit changes**.
4. Vá em **Settings > Pages**. Em *Branch* escolha `main` e `/ (root)`. Salve.
5. Aguarde 1 a 2 minutos. O endereço será `https://SEU-USUARIO.github.io/meu-dinheiro/`.

## Instalar no iPhone
1. Abra o endereço no **Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (quadrado com seta) > **Adicionar à Tela de Início**.
3. Abra sempre pelo ícone novo. Funciona sem internet.

## Backup (importante)
Os dados ficam só neste iPhone. Em **Mais > Backup e restauração > Salvar backup agora**,
escolha **Salvar em Arquivos** (iCloud Drive). O app avisa quando passar de 7 dias sem backup.
Para restaurar (ou passar para outro celular): **Restaurar de um arquivo**.

## Atualizar o app no futuro
Substitua os arquivos no repositório. Seus dados não são afetados, pois ficam no celular.
Se um arquivo mudar, troque também `VERSION` no começo do `sw.js` para o iPhone pegar a versão nova.
