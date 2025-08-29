# Anthropic API key fetcher

simple cli to fetch an anthropic access token using oauth (pkce), built with bun

[![demo video showing using it with crush](https://cap.so/api/video/og?videoId=3a8ysd68ne227qp)](https://cap.link/3a8ysd68ne227qp)

## usage

```bash
bunx anthropic-api-key
npx anthropic-api-key

# override port
PORT=9999 bunx anthropic-api-key

# help
bunx anthropic-api-key --help
```

## what it does

- starts a local server and auto-opens your browser
- guides you through anthropic oauth (pkce)
- prints an access token to stdout and exits
- caches tokens at `~/.config/crush/anthropic` and reuses them on later runs
- if a cached token is still valid, it prints immediately and exits
- if expired and a refresh token exists, it refreshes, saves, prints, and exits

<p align="center">
	<img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/master/.github/images/line-break.svg" />
</p>

<p align="center">
	<i><code>&copy 2025-present <a href="https://github.com/taciturnaxolotl">Kieran Klukas</a></code></i>
</p>

<p align="center">
	<a href="https://github.com/taciturnaxolotl/anthropic-api-key/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=MIT&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
