# Yarvan product site

The project's bilingual [GitHub Pages site](https://ghahremany.github.io/yarvan-agent/) is built from this directory. It is a product introduction, not a hosted agent. Its interactive conversations are scripted and do not send requests, ask for credentials, or connect to an account.

```sh
python3 website/build.py --out /tmp/yarvan-site --preview /tmp/yarvan.html
```

Open `index.html` or the standalone HTML preview in a browser. Python 3 is the only build dependency. For editing: change the Persian/English copy in `messages.json`, the structure in `index.template.html`, and the styling or controls in `site.css` and `site.js`. `?lang=en` opens the English version; Persian is the default. The browser remembers only the theme preference. The fonts, icons, styling and sample messages are embedded, so the preview does not require a CDN.

The initial wordmark stage, chat framing and section rhythm take visual inspiration from [mausbot.com](https://mausbot.com/). This site uses independent markup and illustrations, the Yarvan mark, original copy, and no MausBot hosted assets, endorsements or analytics. See [UPSTREAM.md](../UPSTREAM.md) for the application's upstream attribution. Inter and Vazirmatn are redistributed under their respective SIL Open Font Licenses in `fonts/`.

The **Publish product page** workflow publishes only the built static files. Configure Settings → Pages → Source to **GitHub Actions**. A push affecting this directory on `main` publishes a new version; a manually dispatched run also works on `main`. The separate **Verify Yarvan** workflow still checks the app.
