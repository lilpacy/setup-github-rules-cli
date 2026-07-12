# @lilpacy/setup-github-rules

`npx` で実行できる、GitHub repository ruleset の one-shot setup CLI です。

Terraform は使いません。`terraform.tfstate` も生成しません。内部では GitHub CLI の `gh api` を使って、対象 repository に対して直接 GitHub API を実行します。

## できること

- 現在の git remote から `OWNER/REPO` を自動検出
- 対話的に default branch を選択
  - `main`
  - `develop`
  - 任意の branch
- branch が存在しなければ、現在の GitHub default branch から作成
- repository の `default_branch` を選択した branch に変更
- PR merge 後に head branch を自動削除する repository 設定を有効化
- 対話的に許可する merge 方式（squash / merge / rebase / 変更しない）を選択（任意）
- 選択した branch に対して PR 必須 ruleset を作成または更新
- 誤って入れた PR 必須 ruleset から PR 必須だけを外し、直コミットを再度許可
- branch deletion を禁止
- non-fast-forward / force push 系を禁止
- 既存の同名 ruleset がある場合は更新するので、再実行しやすい
- 各設定は単体でも適用可能（`--branch` / `--allow-direct-commits` / `--merge-method` / `--delete-branch-on-merge`）

## 前提

- Node.js 18+
- git
- GitHub CLI `gh`
- `gh auth login` 済み
- 対象 repository に対する admin 権限

確認:

```bash
gh auth status
```

## 使い方

### 対話式で実行

対象 repository の中で実行します。

```bash
npx @lilpacy/setup-github-rules
```

実行すると、default branch を選べます。

```txt
Choose the repository default branch:
  1) main
  2) develop
  3) other
Select [1/2/3]:
```

### repository を明示する

```bash
npx @lilpacy/setup-github-rules --repo lilpacy/repo-a
```

### branch を非対話で指定する

`--branch` だけを指定すると **branch protection（default branch 変更 + PR 必須 ruleset）だけ**を適用します。merge 後の branch 削除も同時に有効化したい場合は `--delete-branch-on-merge` を併記してください。

```bash
npx @lilpacy/setup-github-rules --repo lilpacy/repo-a --branch develop --yes

# branch protection と merge 後 branch 削除を同時に
npx @lilpacy/setup-github-rules --repo lilpacy/repo-a --branch develop --delete-branch-on-merge --yes
```

### required approvals を指定する

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --branch develop \
  --required-approvals 1 \
  --yes
```

### PR 必須を外して直コミットを再度許可する

誤って PR 経由でしか変更できない ruleset を入れた場合は、対象 branch を指定して `--allow-direct-commits` を実行します。

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --branch develop \
  --allow-direct-commits \
  --yes
```

デフォルトでは `Require PR to <branch>` という名前の ruleset を更新します。別名で作った ruleset を直す場合は `--ruleset-name` も指定してください。

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --branch develop \
  --ruleset-name "Require PR to develop" \
  --allow-direct-commits \
  --yes
```

この操作は ruleset 内の `pull_request` rule だけを外します。branch deletion 禁止や non-fast-forward 禁止など、同じ ruleset 内の他の rule は残します。

### required approvals を対話で選ぶ

`--required-approvals` を省略すると、実行中に `0` から `6` を選べます。Enter だけ押した場合は `0` です。

```txt
Choose the number of required approving reviews.
Use 0 for solo repositories where nobody else can approve your PR.
Required approvals [0-6] (default: 0):
```

1 人で開発している repository なら、通常は `0` を選ぶのが安全です。

### merge 方式を対話で選ぶ

`--merge-method` を省略すると、実行中に許可する merge 方式を選べます。Enter だけ押した場合は「変更しない」です。

```txt
Choose the merge method to allow (restricts to one method).
  1) squash
  2) merge
  3) rebase
  4) no change
Select [1/2/3/4] (default: 4):
```

### 設定を単体で適用する

設定フラグを何も付けずに実行すると、従来どおり全部（branch protection・merge 後 branch 削除など）をまとめて設定します。

一方で `--branch` / `--allow-direct-commits` / `--merge-method` / `--delete-branch-on-merge` のいずれかを付けると、**付けた設定だけ**を適用します。複数を組み合わせることもできます。

merge 方式を squash に固定するだけ:

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --merge-method squash \
  --yes
```

PR merge 後に head branch を自動削除する設定だけを有効にする:

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --delete-branch-on-merge \
  --yes
```

merge 方式固定と branch 削除を同時に（branch protection は触らない）:

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --merge-method squash \
  --delete-branch-on-merge \
  --yes
```

`--required-approvals` は branch protection に紐づくので、単体適用では `--branch` と併用してください。`--ruleset-name` は PR 必須 ruleset の作成・更新と、`--allow-direct-commits` で既存 ruleset を直す場合の両方で使えます。

### dry-run

```bash
npx @lilpacy/setup-github-rules --repo lilpacy/repo-a --dry-run
```

## オプション

| Option | Description | Default |
|---|---|---|
| `--repo OWNER/REPO` | 対象 repository | current git remote から検出 |
| `--branch BRANCH` | 保護する branch。`--allow-direct-commits` 併用時は PR 必須を外す対象 branch | 対話式で選択（フル実行時） |
| `--required-approvals N` | 必須 approval 数。`--branch` が必要 | `0` |
| `--ruleset-name NAME` | 作成・更新する ruleset 名。`--allow-direct-commits` でも使用可能 | `Require PR to <branch>` |
| `--allow-direct-commits` | 対象 branch の ruleset から PR 必須だけを外し、直コミットを許可。`--branch` が必要 | `false` |
| `--merge-method METHOD` | 許可する merge 方式を 1 つに固定。対応値: `squash` / `merge` / `rebase`。省略時はフル実行時に対話式で選択（デフォルト: 変更しない） | 変更しない |
| `--delete-branch-on-merge` | PR merge 後に head branch を自動削除 | フル実行時のみ有効 |
| `--yes`, `-y` | 最終確認をスキップ | `false` |
| `--dry-run` | 変更せず plan だけ表示 | `false` |
| `--help`, `-h` | help 表示 | - |

> 補足: 設定フラグを 1 つでも指定すると「その設定だけ」を適用します。何も指定しなければ全設定をまとめて適用します。

## 実行例

```txt
Plan:
  Repository:           lilpacy/repo-a
  Current default:      main
  New default:          develop
  Protected branch:     develop
  Required approvals:   0
  Ruleset name:         Require PR to develop
  Delete merged branch: enabled

Apply these changes? [y/N]: y
Creating branch 'develop' from 'main'...
Setting default branch to 'develop'...
Enabling automatic branch deletion after merge...
Creating ruleset 'Require PR to develop'...

Done.
Default branch 'develop' now requires Pull Requests before changes can be merged.
Merged Pull Request branches will be deleted automatically.
```

単体適用（merge 方式だけ固定）:

```txt
Plan:
  Repository:           lilpacy/repo-a
  Merge method:         squash only

Apply these changes? [y/N]: y
Restricting merge method to 'squash'...

Done.
Only 'squash' merges are allowed now.
```

## ローカル確認

publish 前にローカルで試す場合:

```bash
cd setup-github-rules-cli
npm link
setup-github-rules --help
```

または package directory を直接指定して実行できます。

```bash
npx --package file:/path/to/setup-github-rules-cli setup-github-rules --help
```

## npm に公開する

この repository は scoped package `@lilpacy/setup-github-rules` として公開する前提です。
`package.json` には `publishConfig.access=public` を入れているので、初回 publish でも `--access public` を毎回付ける必要はありません。

```bash
npm login
npm run prepublishOnly
npm publish
```

公開確認:

```bash
npm view @lilpacy/setup-github-rules version
npx @lilpacy/setup-github-rules --help
```

## 注意点

この CLI は Terraform ではありません。state や desired state 管理はありません。

その代わり、以下の用途に向いています。

- 新規 repository 作成直後に ruleset をすぐ反映したい
- `gh` 認証をそのまま使いたい
- repository 内に IaC ファイルや state を残したくない
- 小〜中規模で、ワンコマンド setup を優先したい

厳密な drift detection、PR review 付きの設定変更、org 全体の一元管理が必要な場合は Terraform / OpenTofu 方式のほうが向いています。
