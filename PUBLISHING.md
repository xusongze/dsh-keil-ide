# Publishing

Notes for the maintainer. Everything in the repository is already release-ready; these are the
steps that need **your** credentials.

---

## 1. Push to GitHub

The local repository is initialised and committed (`main`, tag `v1.0.0`) but has **no remote
yet**.

### Create the repository

Create an empty repository named **`dsh-keil-ide`** on GitHub — do **not** let it add a
README, .gitignore or license, because those already exist here.

- With the web UI: <https://github.com/new> → name `dsh-keil-ide` → **Public** → *no*
  initialisation files → Create.
- With the GitHub CLI, if you install it (`winget install GitHub.cli`):

  ```bash
  gh auth login
  gh repo create dsh-keil-ide --public --source . --remote origin --push
  ```

### Or push over SSH

An SSH key already exists at `~/.ssh/id_ed25519`. Add its public half to GitHub
(<https://github.com/settings/keys>) if you have not already:

```bash
cat ~/.ssh/id_ed25519.pub      # paste this into GitHub → Settings → SSH keys
```

Then, **after replacing `<你的GitHub用户名>`** with the real account name:

```bash
cd path/to/dsh-keil-ide
git remote add origin git@github.com:<你的GitHub用户名>/dsh-keil-ide.git
git push -u origin main
git push origin v1.0.0
```

> ⚠️ `package.json` currently says `"url": "git+https://github.com/xusongze/dsh-keil-ide.git"`.
> If your GitHub username is **not** `xusongze`, fix `repository`, `homepage` and `bugs`
> before pushing — otherwise the npm page links to somebody else's repo.

---

## 2. Publish to npm (optional but recommended)

Publishing to npm is also what puts the plugin in the **DSH plugin market**: `dshmarket`
resolves plugins as `${registry}/${package}/latest`, so an npm release is a market listing.

You will need an npm account first: <https://www.npmjs.com/signup>

```bash
cd path/to/dsh-keil-ide

# 1. log in (opens a browser)
npm login

# 2. confirm the name is still free
npm view dsh-keil-ide version     # should error with 404

# 3. see exactly what would be published BEFORE publishing
npm pack --dry-run

# 4. publish
npm publish
```

The package is unscoped and `private` is not set, so `npm publish` makes it public
immediately.

### After the first publish

- Bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit, tag, then `npm publish`.
- `npm publish` refuses to overwrite an existing version, so a forgotten bump fails loudly
  rather than silently.

---

## 3. Verify

Once published, this should install cleanly:

```bash
cd ~/.dsh/profiles/desktop
npm install dsh-keil-ide
```

…then add `"dsh-keil-ide"` to that profile's `dsh.profile.bundles` and restart DeepSeek
Harness. A name listed in `bundles` but not installed makes DSH refuse to start, so keep the
two in sync.

---

## Release checklist

- [ ] `npm test` — all suites pass
- [ ] `package.json` `version` bumped
- [ ] `CHANGELOG.md` updated
- [ ] `README.md` / `README.zh.md` reflect any new behaviour
- [ ] commit, then `git tag -a vX.Y.Z -m "..."` and push the tag
- [ ] `npm publish`
- [ ] install from npm into a profile once, to prove the published tarball works
