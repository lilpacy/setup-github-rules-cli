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
- 選択した branch に対して PR 必須 ruleset を作成または更新
- branch deletion を禁止
- non-fast-forward / force push 系を禁止
- 既存の同名 ruleset がある場合は更新するので、再実行しやすい

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

```bash
npx @lilpacy/setup-github-rules --repo lilpacy/repo-a --branch develop --yes
```

### required approvals を指定する

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --branch develop \
  --required-approvals 1 \
  --yes
```

### required approvals を対話で選ぶ

`--required-approvals` を省略すると、実行中に `0` から `6` を選べます。Enter だけ押した場合は `0` です。

```txt
Choose the number of required approving reviews.
Use 0 for solo repositories where nobody else can approve your PR.
Required approvals [0-6] (default: 0):
```

1 人で開発している repository なら、通常は `0` を選ぶのが安全です。

### 設定を単体で適用する

通常実行では default branch / ruleset / merge 後 branch 削除をまとめて設定します。
特定の設定だけを適用したい場合は `--only` を使います。

PR merge 後に head branch を自動削除する設定だけを有効にする:

```bash
npx @lilpacy/setup-github-rules \
  --repo lilpacy/repo-a \
  --only delete-branch-on-merge \
  --yes
```

### dry-run

```bash
npx @lilpacy/setup-github-rules --repo lilpacy/repo-a --dry-run
```

## オプション

| Option | Description | Default |
|---|---|---|
| `--repo OWNER/REPO` | 対象 repository | current git remote から検出 |
| `--branch BRANCH` | default branch / protected branch | 対話式で選択 |
| `--required-approvals N` | 必須 approval 数 | `0` |
| `--ruleset-name NAME` | ruleset 名 | `Require PR to <branch>` |
| `--only NAME` | 指定した設定だけを適用。対応値: `delete-branch-on-merge` | 通常のまとめて設定 |
| `--yes`, `-y` | 最終確認をスキップ | `false` |
| `--dry-run` | 変更せず plan だけ表示 | `false` |
| `--help`, `-h` | help 表示 | - |

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

単体適用:

```txt
Plan:
  Repository:           lilpacy/repo-a
  Delete merged branch: enabled

Apply these changes? [y/N]: y
Enabling automatic branch deletion after merge...

Done.
Merged Pull Request branches will be deleted automatically.
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
