# NITRO MOTO

ニトロを溜めて放つ、スマホ向けの横視点モトクロス・エンドレスラン。
自動生成される無限コースを、タップ＆ホールドのニトロ加速だけで走り抜けます。
ライブラリもビルドも不要。バニラ JavaScript と HTML5 Canvas だけで動きます。

## 遊び方

- **画面をタップ＆ホールド**するとニトロを噴射して加速します（ボタンは1つだけ）。
- ニトロはコース上に落ちている**カプセルを拾う**と回復します。撒き散らさずに要所で使うのがコツ。
- 坂を下れば自然に加速、上りや段差で失速します。**ニトロが切れて止まるとクラッシュ**。
- ピット（地面の切れ目）に落ちてもクラッシュ。ジャンプ台でうまく飛び越えましょう。
- ときどき**360度ループ**が出現します。手前で十分に加速していれば一気に駆け上がれます。
- スコアは**走った距離（m）**。クラッシュしたらタップで即リスタート。ベスト記録は自動保存されます。
- 横画面（よこ持ち）専用です。

## ローカルで動かす

ES Modules を使うため、`file://` で直接開くのではなくローカルサーバー経由で開きます。

```bash
cd /home/mihara/開発/モトクロス
python3 -m http.server 8000
```

ブラウザで <http://localhost:8000> を開けば遊べます。

## GitHub Pages で公開する

1. GitHub に空のリポジトリを作成します（例: `nitromoto`）。
2. このフォルダをそのリポジトリへ push します。

   ```bash
   git remote add origin https://github.com/<ユーザー名>/nitromoto.git
   git push -u origin main
   ```

3. リポジトリの **Settings → Pages** を開き、**Build and deployment** を
   **Deploy from a branch** にして、Branch を **main** / フォルダを **/ (root)** に設定して保存します。
4. 数十秒後、`https://<ユーザー名>.github.io/nitromoto/` で公開されます。

## チューニング

挙動の数値は [`js/config.js`](js/config.js) に集約しています。

| 項目 | 効果 |
| --- | --- |
| `NITRO_THRUST` | ニトロ加速の強さ |
| `DRAG` | 速度の減衰（大きいほど止まりやすい） |
| `NITRO_BURN` | ニトロの毎秒消費量 |
| `NITRO_PICKUP` | カプセル1個の回復量 |
| `V_MIN` | これ以下に減速するとストール（失速クラッシュ） |
| `LOOP_SAFETY` | ループ突破に必要な速度の余裕（小さいほど簡単） |

コースの出やすさは [`js/track.js`](js/track.js) で調整できます。

- `nextLoopX` の初期値と再設定間隔 … ループの登場頻度
- `pickType` の重み … 平坦・起伏・上り・下り・ピットの割合

## ファイル構成

```
index.html          画面とHUD（距離・ベスト・ニトロゲージ）
css/style.css       全画面キャンバスとUIのスタイル
js/
  main.js           エントリポイント（固定タイムステップのループ）
  config.js         物理・ゲームの調整パラメータ
  game.js           ゲーム状態と進行（衝突・ループ・クラッシュ判定）
  physics.js        バイクの物理（接地⇄空中の状態遷移）
  track.js          コース自動生成（地形・ピット・ループ・ニトロ配置）
  renderer.js       Canvas 描画
  input.js          タップ／スペースキー入力
  score.js          距離スコアとベスト記録
  storage.js        ベスト記録の保存（localStorage）
tests/              node:test による単体テスト
```

## テスト

```bash
node --test
```

物理・スコア・コース生成のロジックを検証します（外部依存なし）。
