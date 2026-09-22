/*
 * build-slim.mjs — baut die Widget-Set-Artefakte dieses Forks neu und laesst
 * dabei weg, was das Zielprojekt nicht benutzt.
 *
 * Hintergrund: iobroker.vis 1.5.6 backt beim Upload das komplette
 * widgets/materialdesign.html samt aller <script src>/<link href> in
 * www/index.html ein; die Dateien sind dort parser-blockierend. Auf einem
 * Kiosk-Tablet (CPU 4x gedrosselt, 20 Mbit) kostet dieses Widget-Set 2068 ms
 * von 3532 ms bis DOMContentLoaded, davon lib.min.js allein 1304 ms.
 *
 * Was der Build tut:
 *   1. lib.min.js neu aus lib/*.js, ohne die in DROP_LIBS genannten
 *      Bibliotheken (alphabetische Reihenfolge wie im Original).
 *   2. js/widgets.min.js neu aus js/widgets/*.js, nur die in KEEP_WIDGETS
 *      genannten Dateien.
 *   3. widgets/materialdesign.html: die in DROP_TAGS genannten <script src>
 *      entfernen und jeden Widget-Template-Block loeschen, dessen
 *      Implementierung nicht mehr mitgebaut wird.
 *   4. js/materialdesign.js: den Sentry-Aufruf entfernen.
 *
 * Der Build ist idempotent: Eingabe sind immer die unveraenderten Quellen
 * (lib/*.js, js/widgets/*.js und tools/materialdesign.src.html), Ausgabe sind
 * nur die Artefakte. widgets/materialdesign.html ist ein Erzeugnis und darf
 * nicht von Hand bearbeitet werden — sonst ist die naechste Aenderung an
 * KEEP_WIDGETS wirkungslos, weil die entfernten Templates schon fehlen.
 *
 * Nach einem Merge von Upstream: `node tools/build-slim.mjs --adopt` uebernimmt
 * das gemergte widgets/materialdesign.html als neue Quelle und baut danach neu.
 *
 * Aufruf:  node tools/build-slim.mjs [--check|--adopt]
 *   --check  nur pruefen und Groessen melden, nichts schreiben
 *   --adopt  widgets/materialdesign.html -> tools/materialdesign.src.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = path.join(ROOT, 'widgets', 'materialdesign');
const CHECK = process.argv.includes('--check');
const ADOPT = process.argv.includes('--adopt');

// esbuild wird nicht als devDependency gefuehrt, damit `npm i` des Adapters
// schlank bleibt; auf dem ioBroker-Host liegt es ohnehin unter node_modules.
const require_ = createRequire(import.meta.url);
let esbuild;
for (const p of ['esbuild', '/opt/iobroker/node_modules/esbuild']) {
    try { esbuild = require_(p); break; } catch { /* weiter */ }
}
if (!esbuild) throw new Error('esbuild nicht gefunden (npm i esbuild oder Pfad anpassen)');

/* ------------------------------------------------------------------ Konfig */

// Widget-Implementierungen, die im Bundle bleiben. Alles andere entfaellt
// samt zugehoerigem Template im materialdesign.html.
const KEEP_WIDGETS = [
    'materialdesign.00.helper.js',          // Basis, von allem benutzt
    'materialdesign.00.vue.helper.js',      // Vuetify-Basis (Dialog)
    'materialdesign.materialdesignicons.js',// Icon-Namen + Icon-Widget
    'materialdesign.button.js',             // Button-* und Icon-Button-*
    'materialdesign.topappbarnav.js',       // TopAppBar-Navigation
    'materialdesign.dialog.js',             // Vuetify-Dialog-View / -iFrame
    'materialdesign.card.js',               // Card - steckt im Projekt-Template "Button Licht"
    'materialdesign.viseditor.js'           // Attribut-Editor im vis-Editor
];

// Bibliotheken, die nur die entfallenen Widgets brauchten.
//   Chart.js + datalabels + chroma  -> Chart-Bar/-Line/-Pie/-JSON, ColorScheme
//   math.js                          -> value-Widget (math.evaluate)
const DROP_LIBS = ['Chart.js', 'chartjs-plugin-datalabels.js', 'chroma.js', 'math.js'];

// <script src>-Zeilen, die aus materialdesign.html verschwinden.
//   sentry/*                -> reine Telemetrie an sentry.iobroker.net
//   moment-with-locales     -> vis laedt im <head> bereits dasselbe moment 2.19.1
//   round-slider            -> nur fuer das Slider-Round-Widget
const DROP_TAGS = [
    'lib/raw/sentry/bundle.min.js',
    'lib/raw/sentry/captureconsole.min.js',
    'lib/raw/sentry/dedupe.min.js',
    'lib/raw/moment-with-locales.min.js',
    'lib/raw/round-slider.js'
];

/* ------------------------------------------------------------------ Helfer */

const kib = n => (n / 1024).toFixed(1).padStart(8) + ' KiB';
const byName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());

function minifyConcat(files, label) {
    const parts = [];
    for (const f of files) {
        const code = fs.readFileSync(f, 'utf8');
        const out = esbuild.transformSync(code, { minify: true, legalComments: 'none' });
        if (out.warnings && out.warnings.length) {
            for (const w of out.warnings) console.warn(`   ! ${path.basename(f)}: ${w.text}`);
        }
        parts.push(out.code.trim());
    }
    const joined = parts.join('\n;') + '\n';
    console.log(`   ${label}: ${files.length} Dateien -> ${kib(Buffer.byteLength(joined))}`);
    return joined;
}

/* ------------------------------------------------- 1) lib.min.js neu bauen */

const libDir = path.join(W, 'lib');
const libAll = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).sort(byName);
const libKeep = libAll.filter(f => !DROP_LIBS.includes(f));
const fehlend = DROP_LIBS.filter(f => !libAll.includes(f));
if (fehlend.length) throw new Error(`DROP_LIBS nennt nicht vorhandene Dateien: ${fehlend}`);
console.log(`lib.min.js: ${libKeep.length} von ${libAll.length} Bibliotheken ` +
    `(raus: ${DROP_LIBS.join(', ')})`);
const libMin = minifyConcat(libKeep.map(f => path.join(libDir, f)), 'lib.min.js');

/* -------------------------------------------- 2) widgets.min.js neu bauen */

const wDir = path.join(W, 'js', 'widgets');
const wAll = fs.readdirSync(wDir).filter(f => f.endsWith('.js')).sort(byName);
const unbekannt = KEEP_WIDGETS.filter(f => !wAll.includes(f));
if (unbekannt.length) throw new Error(`KEEP_WIDGETS nennt nicht vorhandene Dateien: ${unbekannt}`);
const wKeep = wAll.filter(f => KEEP_WIDGETS.includes(f));
const wDrop = wAll.filter(f => !KEEP_WIDGETS.includes(f));
console.log(`widgets.min.js: ${wKeep.length} von ${wAll.length} Widget-Dateien`);
const widgetsMin = minifyConcat(wKeep.map(f => path.join(wDir, f)), 'widgets.min.js');

/* --------------------------- Gegenprobe: keine Referenz in Entferntes ---- */

// Welche vis.binds.materialdesign.<name> definiert welche Datei?
const owner = new Map();
for (const f of wAll) {
    const t = fs.readFileSync(path.join(wDir, f), 'utf8');
    for (const m of t.matchAll(/vis\.binds\.materialdesign\.([A-Za-z0-9_]+)\s*=/g)) {
        if (!owner.has(m[1])) owner.set(m[1], new Set());
        owner.get(m[1]).add(f);
    }
}
const droppedBinds = new Set();
for (const [name, fs_] of owner) {
    if ([...fs_].every(f => wDrop.includes(f))) droppedBinds.add(name);
}
const verstoesse = [];
for (const f of wKeep) {
    const t = fs.readFileSync(path.join(wDir, f), 'utf8');
    for (const m of t.matchAll(/vis\.binds\.materialdesign\.([A-Za-z0-9_]+)/g)) {
        if (droppedBinds.has(m[1])) verstoesse.push(`${f} -> ${m[1]}`);
    }
}
for (const lib of DROP_LIBS) {
    const global = { 'Chart.js': 'Chart', 'chroma.js': 'chroma', 'math.js': 'math' }[lib];
    if (!global) continue;
    for (const f of wKeep) {
        const t = fs.readFileSync(path.join(wDir, f), 'utf8');
        if (new RegExp(`(?<![\\w.$])${global}\\s*[.(]`).test(t)) verstoesse.push(`${f} -> ${global}`);
    }
}

/* ----------------------------------- 3) materialdesign.html zurechtstutzen */

const htmlPath = path.join(ROOT, 'widgets', 'materialdesign.html');
// Quelle ist die unveraenderte Upstream-Fassung, NICHT das eigene Erzeugnis.
const srcPath = path.join(ROOT, 'tools', 'materialdesign.src.html');
if (ADOPT) {
    fs.copyFileSync(htmlPath, srcPath);
    console.log('--adopt: widgets/materialdesign.html als neue Quelle uebernommen');
}
if (!fs.existsSync(srcPath)) {
    throw new Error(`${path.relative(ROOT, srcPath)} fehlt. Einmalig anlegen:\n` +
        '  git show <upstream-tag>:widgets/materialdesign.html > tools/materialdesign.src.html');
}
let html = fs.readFileSync(srcPath, 'utf8');

for (const tag of DROP_TAGS) {
    const re = new RegExp(`^[ \\t]*<script[^>]*src="widgets/materialdesign/${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*</script>[ \\t]*\\r?\\n`, 'm');
    if (!re.test(html)) throw new Error(`<script>-Tag nicht gefunden: ${tag}`);
    html = html.replace(re, '');
}

// Template-Bloecke entfernen, deren Implementierung entfallen ist.
const blockRe = /[ \t]*<script\s+id="(tplVis-materialdesign[^"]*)"[\s\S]*?<\/script>[ \t]*\r?\n/g;
const entfernt = [];
const behalten = [];
html = html.replace(blockRe, (block, id) => {
    const refs = [...block.matchAll(/vis\.binds\.materialdesign\.([A-Za-z0-9_]+)/g)].map(m => m[1]);
    const trifft = refs.filter(r => owner.has(r));
    // Kein erkennbarer Bezug -> im Zweifel behalten.
    const raus = trifft.length > 0 && trifft.every(r => droppedBinds.has(r));
    if (raus) { entfernt.push(id); return ''; }
    behalten.push(id);
    for (const r of trifft) if (droppedBinds.has(r)) verstoesse.push(`Template ${id} -> ${r}`);
    return block;
});
console.log(`materialdesign.html: ${behalten.length} Templates bleiben, ${entfernt.length} entfernt`);

/* -------------------------------------- 4) Sentry-Aufruf aus dem Bootstrap */

// js/materialdesign.js wird nur um eine Zeile gekuerzt; das ist in beide
// Richtungen erkennbar und braucht deshalb keine eigene Quelldatei.
const mdPath = path.join(W, 'js', 'materialdesign.js');
const mdOrig = fs.readFileSync(mdPath, 'utf8');
const sentryRe = /^[ \t]*myMdwHelper\.initializeSentry\(version\);[ \t]*\r?\n/m;
if (!sentryRe.test(mdOrig) && !/initializeSentry/.test(mdOrig)) {
    console.log('   Sentry-Aufruf bereits entfernt');
} else if (!sentryRe.test(mdOrig)) {
    throw new Error('Sentry-Aufruf gefunden, aber nicht in der erwarteten Form');
}
const md = mdOrig.replace(sentryRe, '');

/* ----------------------------------------------------------------- Abschluss */

if (verstoesse.length) {
    console.error('\nABBRUCH — Behaltenes verweist auf Entferntes:');
    for (const v of [...new Set(verstoesse)]) console.error('   ' + v);
    process.exit(1);
}

const ziele = [
    [path.join(W, 'lib.min.js'), libMin],
    [path.join(W, 'js', 'widgets.min.js'), widgetsMin],
    [htmlPath, html],
    [mdPath, md]
];
console.log('\nErgebnis:');
for (const [p, inhalt] of ziele) {
    const alt = fs.existsSync(p) ? fs.statSync(p).size : 0;
    const neu = Buffer.byteLength(inhalt);
    console.log(`   ${path.relative(ROOT, p).padEnd(42)} ${kib(alt)} -> ${kib(neu)}  (${(100 * (neu - alt) / alt).toFixed(1)} %)`);
    if (!CHECK) fs.writeFileSync(p, inhalt);
}
console.log(CHECK ? '\n--check: nichts geschrieben.' : '\nGeschrieben.');
