# Schlanker Fork von ioBroker.vis-materialdesign

Basis: **Scrounger/ioBroker.vis-materialdesign 0.5.9** (Tag `0.5.9`, Commit `f0f40c1`).
Diese Fassung ist **0.5.10** und auf genau ein Projekt zugeschnitten. Sie ist nicht
für den allgemeinen Gebrauch gedacht und wurde upstream nicht eingereicht.

## Warum

`iobroker.vis` 1.5.6 backt beim Upload das komplette `widgets/materialdesign.html`
samt aller `<script src>`/`<link href>` in `www/index.html` ein; die Dateien sind
dort parser-blockierend. Auf einem gedrosselten Gerät (CPU 4×, 20 Mbit/s, 20 ms
Latenz) kostete das Widget-Set **2068 ms von 3532 ms** bis `DOMContentLoaded` —
`lib.min.js` allein 1304 ms. Das Zielprojekt benutzt davon vier Widgettypen.

## Was entfernt wurde

| Bereich | entfernt |
|---|---|
| Bibliotheken in `lib.min.js` | `Chart.js`, `chartjs-plugin-datalabels.js`, `chroma.js`, `math.js` |
| Widget-Implementierungen in `js/widgets.min.js` | alles außer `00.helper`, `00.vue.helper`, `materialdesignicons`, `button`, `topappbarnav`, `dialog`, `viseditor` |
| Templates in `materialdesign.html` | 23 von 47 (Charts, Tabelle, Liste, Icon-List, Eingabefelder, Select, Switch, CheckBox, Slider, Progress, Card, Alerts, Calendar, Grid-/Masonry-Views, ColorScheme-Preview, value) |
| `<script src>` in `materialdesign.html` | die drei Sentry-Bündel, das zweite `moment-with-locales` (vis lädt im `<head>` bereits dasselbe moment 2.19.1), `round-slider.js` |
| `js/materialdesign.js` | der Aufruf `myMdwHelper.initializeSentry(version)` |

**Es bleiben 24 Widgettypen:** alle `Button-*` und `Icon-Button-*` (je 6 Varianten,
waagerecht und senkrecht), `Icon`, `TopAppBar-Navigation`, `Vuetify-Dialog-View`,
`Vuetify-Dialog-iFrame`, `Installed-Version`.

Die CSS-Dateien sind unverändert — dort ist wenig zu holen, und das Risiko für das
Layout wäre höher als der Gewinn.

## Wirkung (gemessen, CPU 4× / 20 Mbit, gepaarte Messung n=4)

| | kalt | warm |
|---|---:|---:|
| bis interaktiv, Original | 4192 ms | 3395 ms |
| bis interaktiv, dieser Fork | **3390 ms (−791)** | **2402 ms (−1018)** |

Auslieferungsgrößen (gzip): `lib.min.js` 497 → 307 KiB, `js/widgets.min.js`
92 → 49 KiB, `materialdesign.html` 20 → 8 KiB, dazu entfallen ~99 KiB
(moment, Sentry, round-slider).

## Neu bauen

```bash
node tools/build-slim.mjs --check   # nur prüfen, nichts schreiben
node tools/build-slim.mjs           # Artefakte neu schreiben
```

Das Skript liest immer die unveränderten Quellen unter `widgets/materialdesign/lib/`
und `widgets/materialdesign/js/widgets/` und schreibt daraus `lib.min.js`,
`js/widgets.min.js`, `widgets/materialdesign.html` und `js/materialdesign.js` neu.
Es bricht ab, wenn eine behaltene Datei oder ein behaltenes Template auf etwas
Entferntes verweist. Minifiziert wird mit esbuild.

**Nach einem Merge von Upstream muss `tools/build-slim.mjs` erneut laufen**, sonst
stehen die Originalartefakte wieder im Baum.

## Zurück auf Upstream

```bash
cd /opt/iobroker && ./iobroker url iobroker.vis-materialdesign@0.5.9 && ./iobroker restart vis.0
```
