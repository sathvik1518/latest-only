# latest-only

`latestOnly(run)` wraps any async function so only the newest call counts: it cancels the previous call and ignores a late answer from it.

```bash
npm install
npm test
npm run typecheck
```

See `DOCUMENTATION.md` for the full write-up.
