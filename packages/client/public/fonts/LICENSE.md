# JetBrains Mono

`jetbrains-mono-latin.woff2` and `jetbrains-mono-latin-ext.woff2` are the latin
and latin-ext subsets of JetBrains Mono (variable, weight axis 100–800), served
here instead of from Google Fonts so that the web client makes no third-party
request on load and the Tauri desktop build works offline.

Google also publishes cyrillic, greek and vietnamese subsets. They are not
carried here: the UI ships in en/zh/ja, those ranges would only ever appear
inside an arbitrary peer name, and the system monospace fallback handles them
the same way it already handles CJK, which JetBrains Mono does not cover at all.
Adding one is a matter of downloading the file and pasting one more `@font-face`
— the `unicode-range` keeps it from being fetched unless it is needed.

- Upstream: https://github.com/JetBrains/JetBrainsMono
- Subset source: Google Fonts (`fonts.gstatic.com`), family version v24
- Licence: **SIL Open Font License 1.1** — https://openfontlicense.org

The OFL permits redistribution of the font, bundled with software, provided the
licence notice travels with it. That is what this file is for. The font is not
sold on its own and is not renamed, so no further conditions apply.

To refresh the subset, request the Google Fonts CSS with a woff2-capable
user-agent and take the `@font-face` block whose `unicode-range` begins
`U+0000-00FF` — that is the latin subset. Keep the `unicode-range` in
`src/index.css` in step with whatever the new CSS declares.
