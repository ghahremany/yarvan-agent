# Contributing to Yarvan

Changes to this open-source edition are welcome under [Apache-2.0](LICENSE). Please submit only code and assets you have the right to contribute. This repository does not accept Enterprise source or copies of customer data. Retain upstream copyright statements and third-party notices; see [UPSTREAM](UPSTREAM.md).

Use a clean `OMB_DATA_DIR` and synthetic data. Run `pnpm i18n:check`, `pnpm test:yarvan`, and `pnpm test:yarvan:bundle`. Explain what changed, which cases you tested, and which real providers or operating systems you did not test. Add an isolation regression when changing project notes, Telegram, or replay. Never include live tokens in a patch, test fixture or screenshot. See [SECURITY](SECURITY.md) for private reporting.
