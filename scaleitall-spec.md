# Figma Plugin Specification
## „Scale Design System" — Generisch

**Zweck:** Skaliert ein bestehendes Figma-Designsystem von einer Auflösung auf eine andere. Alle pixelgebundenen Werte werden mit einem berechneten Faktor multipliziert und mathematisch gerundet. Werte die durch Variables oder Styles gesteuert werden, werden nur an der Quelle angepasst — nicht an den gebundenen Nodes.

---

## Architektur

Das Plugin besteht aus zwei Teilen: einer UI-Schicht die im Browser läuft, und einer Plugin-Logik die im Figma-Sandbox-Kontext läuft. Beide kommunizieren ausschliesslich über den `postMessage`-Mechanismus der Figma Plugin API.

---

## UI

### Eingaben

- **Faktor** — wird direkt eingegeben (z.B. `0.667`). Muss eine positive Zahl > 0 sein. Ungültige Eingaben (≤ 0, leer, nicht-numerisch) werden vor dem Start abgefangen und dem Nutzer als Fehlermeldung angezeigt.

### Schritte

Die Ausführung ist in vier Schritte aufgeteilt, die einzeln oder gemeinsam über „Run All" ausgeführt werden können. Die empfohlene Reihenfolge ist:

1. Variables
2. Text Styles
3. Effect & Paint Styles
4. Canvas

### Undo-Verhalten

Jeder Schritt soll als eine zusammenhängende Operation ausgeführt werden, sodass er in Figma als ein einziger Undo-Schritt erscheint.

### UI-Verhalten während der Ausführung

Ein Run kann mehrere Minuten dauern. Die UI muss während dieser Zeit responsiv bleiben und den Fortschritt kommunizieren:

- **Buttons deaktiviert** für die Dauer des Runs (kein Doppelstart möglich)
- **Fortschrittsanzeige** zeigt den aktuellen Schritt und — in Schritt 4 — die aktuelle Page (z.B. „Canvas — Page 2 / 5: Icons")
- **Async-Verarbeitung:** Die Plugin-Logik gibt zwischen Pages und in regelmässigen Abständen die Kontrolle zurück (z.B. via `await new Promise(r => setTimeout(r, 0))`), damit Figma nicht einfriert
- **Abschlussmeldung** nach erfolgreichem Run (z.B. „Done — 4 pages, 1.247 nodes scaled")
- **Fehlermeldung** wenn ein Schritt fehlschlägt, mit Angabe des fehlgeschlagenen Schritts

---

## Skalierungsregel

Alle pixelgebundenen Werte werden mit dem Faktor multipliziert und **mathematisch gerundet** (≥ 0.5 → aufrunden). Ausnahmen sind explizit vermerkt.

**Globaler Minimalwert:** War der ursprüngliche Wert ≥ 1, beträgt der skalierte Wert mindestens 1 (d.h. `max(1, round(value × factor))`). War der ursprüngliche Wert < 1, wird normal skaliert ohne Minimum. Diese Regel gilt für alle direkt skalierten Properties in allen Schritten.

**Hinweis zu negativen Werten:** Shadow-Offsets (`offset.x`, `offset.y`) können negativ sein. Die Minimalwert-Regel greift dort nicht (Wert < 1). Bei starker Verkleinerung kann ein Offset von z.B. `-1` auf `0` gerundet werden, wodurch die Richtung des Schattens verloren geht. Dies wird akzeptiert, da ein Sub-Pixel-Schatten in der Zielauflösung visuell nicht relevant ist.

---

## Verbot: Figma-interne Skalierungs-API

Das Plugin darf **niemals** `node.rescale()` oder vergleichbare Figma-interne Skalierungsmethoden verwenden. Diese Methoden:

- ignorieren Variable-Bindungen und skalieren gebundene Properties direkt am Node
- kennen keine Instance-Overwrite-Logik
- können nach Schritt 1–3 eine Doppelskalierung verursachen

Alle Skalierungen erfolgen ausschliesslich durch direktes Lesen und Schreiben einzelner Properties gemäss den Regeln dieser Spec.

---

## Grundprinzip: Prüfreihenfolge vor jedem Schreibzugriff

Bevor das Plugin einen Wert an einem Node schreibt, werden drei Bedingungen in dieser Reihenfolge geprüft:

1. **Variable-gebunden?** Property ist in `boundVariables` des Nodes eingetragen → **überspringen.** Der Wert wird über Schritt 1 (Variables) gesteuert und propagiert sich automatisch.

2. **Style-gebunden?** Property wird durch einen lokalen Text-, Effect- oder Paint-Style gesteuert → **überspringen.** Der Wert wird über Schritt 2 oder 3 gesteuert und propagiert sich automatisch.

3. **Instance-Descendant?** Node ist eine Instance oder liegt innerhalb einer Instance → **nur schreiben wenn die Property in `overriddenFields` steht** (siehe Grundprinzip: Instance-Overwrites).

Nur wenn alle drei Prüfungen bestanden sind, wird der Wert skaliert und geschrieben.

---

## Grundprinzip: Instance-Overwrites

Instances erben ihre Werte vom zugehörigen Master-Component. Wenn der Master-Component in Schritt 4 (Canvas) skaliert wird, propagieren sich die Werte automatisch auf alle Instances. Um eine Doppelskalierung zu verhindern, darf das Plugin Instance-Properties grundsätzlich **nicht** direkt schreiben.

**Ausnahme: Explizite Overwrites.** Wurde eine Property an einer Instance vom Designer manuell überschrieben, existiert sie als Overwrite und muss separat skaliert werden — sie ist vom Master-Component entkoppelt.

### Erkennung via Figma API

Jede `InstanceNode` stellt `instance.overrides` bereit:

```
instance.overrides → Array<{ id: string, overriddenFields: OverrideField[] }>
```

`id` ist die Node-ID des überschriebenen Descendants (oder der Instance selbst). `overriddenFields` listet die konkret überschriebenen Properties.

### Vorgehen

1. `instance.overrides` auslesen
2. Für jede Node-ID im Array: ausschliesslich die dort gelisteten Properties skalieren
3. Properties die **nicht** in `overriddenFields` stehen: nicht anfassen — auch dann nicht, wenn der Wert zufällig identisch mit dem wäre, was das Plugin schreiben würde
4. Das Plugin schreibt **nie** eine Property an eine Instance, die dort nicht bereits als Overwrite existiert — es werden keine neuen Overwrites erzeugt

### Rekursivität

Das Prinzip gilt für alle Descendants einer Instance, egal wie tief verschachtelt. Auch ein Node drei Ebenen tief innerhalb einer Instance wird nur angepasst, wenn seine Properties explizit in `overrides` gelistet sind.

---

## Schritt 1 — Variables

Alle lokalen Variablen vom Typ `FLOAT` werden skaliert. Variablen anderer Typen (insbesondere `COLOR`) werden nicht berührt. Hat eine Variable mehrere Modes, wird jeder Mode-Wert einzeln skaliert.

**Effekt:** Figma propagiert die geänderten Werte automatisch in alle Nodes die an diese Variablen gebunden sind — padding, gap, radius, Höhen etc. werden dadurch ohne weiteres Zutun des Plugins aktualisiert.

---

## Schritt 2 — Text Styles

Alle lokalen Text Styles werden angepasst. Folgende Properties werden skaliert, sofern sie in Pixeln angegeben sind:

- `fontSize` — immer skalieren
- `lineHeight` — nur wenn `unit === 'PIXELS'`. `AUTO` und prozentuale Werte bleiben unverändert.
- `letterSpacing` — nur wenn `unit === 'PIXELS'`. Prozentuale Werte bleiben unverändert.

**Effekt:** Figma propagiert die geänderten Werte in alle gebundenen TEXT-Nodes.

---

## Schritt 3 — Effect Styles & Paint Styles

### Effect Styles

Alle Effekte mit Dimensionswerten werden skaliert:

- **Blur** (`BACKGROUND_BLUR`, `LAYER_BLUR`): `radius` skalieren
- **Drop Shadow** und **Inner Shadow**: `radius` (blur), `spread`, `offset.x`, `offset.y` skalieren

### Paint Styles

Enthält ein Paint Style einen Gradienten (`GRADIENT_LINEAR`, `GRADIENT_RADIAL`, `GRADIENT_ANGULAR`), werden die **Translationskoeffizienten (e, f)** der `gradientTransform`-Matrix skaliert.

Die Matrix ist eine 2×3 Affin-Transformationsmatrix. Die Rotationskoeffizienten (a, b, c, d) sind dimensionslos und werden nicht verändert. Nur e und f repräsentieren Positionswerte und werden mit dem Faktor multipliziert — **ohne ganzzahlige Rundung**, da es sich um Transformationskoeffizienten handelt.

**⚠ Verifikationsbedarf:** Figmas `gradientTransform` bildet vom Gradienten-Koordinatenraum in die Bounding Box des Nodes ab. Falls e und f in **normalisierten Koordinaten** (0–1, relativ zur Node-Grösse) vorliegen, wären sie bereits grössenunabhängig und dürften **nicht** skaliert werden — die Node-Resize in Schritt 4 würde den Gradienten automatisch korrekt positionieren. Falls e und f hingegen in **absoluten Pixeln** vorliegen, ist die Skalierung korrekt. Dies muss gegen die aktuelle Figma-API verifiziert werden.

`GRADIENT_DIAMOND` wird stillschweigend übersprungen.

---

## Schritt 4 — Canvas

Alle Nodes auf allen Pages werden **bottom-up** traversiert und skaliert — Blatt-Nodes zuerst, dann aufwärts bis zum Root, page-weise. Inklusive hidden Nodes. Zwischen Pages gibt das Plugin die Kontrolle zurück, damit die UI aktualisiert werden kann.

---

## Grundprinzip: Top-Level-Positionierung via Anchor

Top-Level-Nodes (direkte Kinder einer PAGE) werden **nicht** einfach mit `x * factor` skaliert. Stattdessen wird die Position relativ zum **Bounding-Box-Anker** aller Top-Level-Frames berechnet. Der Anker wird **einmal pro Page** vor Beginn der Traversierung berechnet und bleibt während der gesamten Page-Verarbeitung konstant — er darf nicht nach jeder Node-Repositionierung neu berechnet werden, da sich die Bounding Box sonst verschieben und die Proportionen verzerren würde.

```
anchor = top-left corner of the bounding box of all direct PAGE children
x_new  = anchor.x + round((x - anchor.x) * factor)
y_new  = anchor.y + round((y - anchor.y) * factor)
```

**Warum:** Ein einfaches `x * factor` würde Frames die weiter vom Ursprung entfernt sind stärker verschieben als nahe Frames, wodurch die Abstände zwischen Frames nach der Skalierung nicht mehr proportional zueinander wären. Die Anchor-Formel erhält die proportionalen Abstände.

Verschachtelte Nodes (innerhalb eines Frames) verwenden weiterhin `scale(x, factor)`, da ihre Koordinaten bereits relativ zum Eltern-Frame angegeben sind und dort die Proportionen inherent korrekt sind.

---

## Grundprinzip: SCALE-Constraint

Figma wende eine `SCALE`-Constraint automatisch an, wenn der **Parent-Frame** resized wird: der Node wird proportional zur Elterngrösse skaliert. Da das Plugin den Parent-Frame in Schritt 4 skaliert (bottom-up), wird ein SCALE-gebundener Node dadurch **automatisch** korrekt skaliert.

Das Plugin darf eine solche Property **nicht** zusätzlich direkt schreiben — das würde eine Doppelskalierung verursachen:
- `horizontal === 'SCALE'` → `x` und `width` nicht direkt schreiben
- `vertical === 'SCALE'` → `y` und `height` nicht direkt schreiben

Diese Prüfung (`hasScaleConstraint`) wird der Prüfreihenfolge (Variable → Style → Instance-Overwrite) als **vierte Bedingung** nachgestellt, bevor ein Wert geschrieben wird.

**Ausnahme: VECTOR-Nodes.** Bei VECTORs kann nicht auf den Parent-Resize vertraut werden (siehe VECTOR-Grundprinzip unten). Dort werden SCALE-gebundene Achsen manuell skaliert und die Constraint danach zu MIN demoted.

---

## Grundprinzip: MAX-Constraint — Pre-Positioning

Ein Node mit `horizontal === 'MAX'` hat einen **fixen Abstand zum rechten Rand** seines Eltern-Frames. Wenn der Eltern-Frame resized wird, repositioniert Figma den Node so, dass dieser Abstand konstant bleibt.

Da das Plugin den Parent bottom-up noch **nicht** resized hat, wenn es den Child-Node bearbeitet, muss `x` auf einen Vorab-Wert gesetzt werden, sodass nach dem späteren Parent-Resize die korrekte Endposition resultiert. Dieses Prinzip gilt für alle nicht-`WIDTH_AND_HEIGHT`-Nodes.

### Fall 1: Nicht-`WIDTH_AND_HEIGHT`-Text und alle anderen Nodes

Korrekte Formel:

```
x_pre = parentW − newParentW + scale(x, factor)
```

Dabei ist `newParentW` die Breite des Elterns nach seiner Skalierung (nur wenn `layoutSizingHorizontal === 'FIXED'`, sonst `newParentW = parentW`). Diese Formel setzt `x` so, dass der Node nach dem Parent-Resize exakt an der skalierten Position landet.

### Fall 2: TEXT-Node mit `textAutoResize === 'WIDTH_AND_HEIGHT'`

Bei diesen Nodes gibt es eine dreistufige Kaskade, die eine andere Formel erfordert:

1. **`scalePosition`** setzt `x` auf einen Vorab-Wert (dieser Schritt)
2. **`scaleTextProperties`** ändert `fontSize` → Figma löst `WIDTH_AND_HEIGHT`-Auto-Resize aus → da der Node `MAX`-Constraint hat, **pinnt Figma die rechte Kante** auf `x + originalWidth` und berechnet `x` neu
3. **`scaleSize` des Parent-Frames** resized den Frame → Figma hält den aktuellen `rightDist` konstant

Die richtige Endposition ergibt sich nur, wenn vor Schritt 3 gilt:
`rightDist_in_originalFrame = scale(originalRightDist, factor)`

Das bedeutet: der Vorab-Wert aus Schritt 1 muss so gewählt sein, dass nach der automatischen Verschiebung in Schritt 2 der `rightDist` genau dem skalierten Wert entspricht.

Herleitung:
```
rightDist        = parentW − x − nodeW       (nodeW = Breite VOR Font-Resize)
desiredRightDist = scale(rightDist, factor)

Ziel: Nach Schritt 2 soll rightDist_after = desiredRightDist gelten.

Schritt 2 pinnt die rechte Kante bei x_pre + nodeW.
Nach Font-Resize ändert sich die Breite auf newW, rechte Kante bleibt:
  x_after = (x_pre + nodeW) − newW

rightDist_after = parentW − x_after − newW
               = parentW − (x_pre + nodeW − newW) − newW
               = parentW − x_pre − nodeW

Setze rightDist_after = desiredRightDist:
  parentW − x_pre − nodeW = desiredRightDist
  x_pre = parentW − nodeW − desiredRightDist
```

Korrekte Formel (exakt, keine Approximation):
```
x_pre = parentW − nodeW − scale(rightDist, factor)
      = parentW − nodeW − scale(parentW − x − nodeW, factor)
```

**Hinweis:** `newW` kürzt sich in der Herleitung vollständig heraus — die Formel ist unabhängig von der Breite nach dem Font-Resize.

**Warum `scale(x, factor)` falsch ist:** Damit landet `x_after_fontresize` bei `parentW − nodeW − rightDist_original`, d.h. der `rightDist` bleibt unverändert — er skaliert nicht mit.

**Warum die Standard-Formel `parentW − newParentW + scale(x, factor)` falsch ist:** Sie ignoriert die Kaskade aus Schritt 2 und setzt `x_pre` zu gross, was nach dem Font-Resize zu einem weit nach rechts verschobenen Node führt.

Das gleiche gilt analog für `vertical === 'MAX'` mit `textAutoResize === 'WIDTH_AND_HEIGHT'`, wobei `y`, `height` und `bottomDist` verwendet werden.

---

## Grundprinzip: GROUP-in-AutoLayout — Achsen-Unterdrückung

Wenn ein Node Kind eines **GROUPs** ist, der selbst innerhalb eines **AutoLayout-Frames** liegt, speichert Figma die Koordinaten des Nodes im absoluten Koordinatenraum des AutoLayout-Frames (nicht relativ zum GROUP). Das hat eine kritische Konsequenz:

- Auf der **AutoLayout-Achse** (x bei `HORIZONTAL`, y bei `VERTICAL`) repositioniert AutoLayout den GROUP automatisch. Wenn das Plugin diese Achse bei den GROUP-Kindern explizit skaliert, entsteht ein Konflikt — insbesondere bei TEXT-Nodes, bei denen `loadFontAsync` eine STRETCH-Constraint-Re-Evaluierung auslöst, die zu kaskadierten Positionsverschiebungen führt.
- Die **Gegenachse** (y bei `HORIZONTAL`, x bei `VERTICAL`) wird von AutoLayout nicht gesteuert und muss weiterhin explizit skaliert werden.

Regel: Bei Kindern eines GROUPs, der in einem AutoLayout-Frame liegt, wird die x-Koordinate (bei `HORIZONTAL`-Layout) bzw. y-Koordinate (bei `VERTICAL`-Layout) **nicht** geschrieben.

---

## Grundprinzip: TEXT — textAutoResize-Beibehaltung

Der Figma-API-Aufruf `node.resize()` setzt `textAutoResize` immer auf `NONE` zurück, was die automatische Grössanpassung des Textfelds dauerhaft deaktiviert. Das Plugin muss je nach ursprünglichem Modus unterschiedlich vorgehen:

| `textAutoResize` | Verhalten |
|---|---|
| `WIDTH_AND_HEIGHT` | Kein `resize()` — beide Dimensionen werden durch `fontSize` gesteuert; `scaleTextProperties` skaliert fontSize und der Text passt sich danach automatisch an |
| `HEIGHT` | Nur Breite resizen (`resize(newW, oldH)`), danach `textAutoResize = 'HEIGHT'` explizit wiederherstellen, damit Höhe weiter auto-fittet |
| `NONE` / `TRUNCATE` | Normales `resize()` — beide Dimensionen werden direkt gesetzt |

---

## Grundprinzip: VECTOR — Constraints und Parent-Resize

VECTOR-Nodes werden manuell skaliert statt über den Parent-Resize, weil ein nicht-uniformer Resize die Pfadgeometrie und Image-Fill-Transforms dauerhaft verzerrt. Dabei gibt es zwei Sonderfälle bei Constraints:

### SCALE-Constraint am VECTOR

Ein Parent-Resize auf einen VECTOR mit `SCALE`-Constraint wäre problematisch: Hat der VECTOR z.B. `horizontal=SCALE, vertical=CENTER`, skaliert der Parent-Resize nur die Breite, nicht die Höhe — was die Pfadgeometrie **nicht-uniform** verzerrt.

Lösung: Der VECTOR wird **manuell und uniform** resized (gleicher Faktor auf beiden Achsen → keine Pfadverzerrung). Danach werden `SCALE`- **und** `CENTER`-Constraints auf `MIN` demoted, damit der Parent-Resize weder doppelskaliert noch die manuell gesetzte Position überschreibt. Die Demotion wirkt sofort, da die Bottom-Up-Traversierung den Child vor dem Parent verarbeitet und Figma Property-Änderungen zwischen API-Aufrufen sofort übernimmt.

### CENTER-Constraint am VECTOR (ohne SCALE)

Figmas CENTER-Constraint behält einen **konstanten Offset** vom Mittelpunkt des Elterns — keine proportionale Fraktion. Nach einem Parent-Resize würde dieser konstante Offset den Node falsch positionieren.

Lösung: Identisch zum allgemeinen CENTER-Prinzip (siehe unten): Offset zurückrechnen, Zielposition direkt berechnen, danach CENTER → MIN demoten.

### CENTER-Constraint an allen anderen Nodes

CENTER-Constraint bedeutet: Figma speichert einen konstanten Offset vom Mittelpunkt des Elterns (`offset = node_center − parent_center`). Beim Parent-Resize repositioniert Figma den Node: `x = new_parent_center + offset − node_w/2`.

Ein einfaches `scale(x)` ist hier falsch, aus zwei Gründen:

**Problem 1 — HUG-Frames und Bottom-Up-Traversal:** Wenn Kinder-Nodes zuerst skaliert werden (bottom-up) und dieser Node ein HUG-Frame ist, resized Figma ihn automatisch. CENTER feuert sofort und repositioniert den Node. Wenn `scalePosition` danach läuft, liest es das bereits verschobene x — nicht das Original. `scale(verschobenes_x)` ergibt einen falschen Wert.

**Problem 2 — Korrumpierter Offset nach Parent-Resize:** Wenn wir `scale(x)` schreiben, ändert sich der gespeicherte CENTER-Offset. Beim späteren Parent-Resize feuert CENTER mit dem falschen Offset und überschreibt x erneut.

**Lösung:** Den gespeicherten CENTER-Offset aus den aktuellen Werten zurückrechnen (er ist stabil durch HUG-Resize hindurch, weil CENTER ihn immer erhält) und die Zielposition direkt berechnen:

```
offset = (current_x + current_w/2) − parent_w/2    // stabil trotz HUG-Resize
new_x  = new_parent_center + offset − new_node_w/2

// new_parent_center = scale(parent_w)/2  wenn Parent FIXED
//                   = parent_w/2          wenn Parent HUG/FILL (bereits am Zielwert)
// new_node_w = current_w                  wenn Node HUG (Kinder-Resize hat es bereits gesetzt)
//            = scale(current_w)           wenn Node FIXED (scaleSize wird es danach setzen)
```

Danach CENTER → MIN demoten (nur die Achsen, auf denen x/y geschrieben wurde), damit der Parent-Resize die manuell berechnete Position nicht überschreibt.

---

### Skalierte Properties pro Node

Für jeden Node werden alle zutreffenden Properties geprüft und — nach bestandener Prüfreihenfolge (Variable → Style → Instance-Overwrite) — skaliert:

#### Position
- `x`, `y` — skalieren, **wenn:**
  - Parent ist kein AutoLayout-Frame, **oder**
  - Node hat `layoutPositioning === 'ABSOLUTE'` (absolut positioniert innerhalb eines AutoLayout-Frames)
- **MIN / kein Constraint:** `scale(x, factor)` — einfache proportionale Skalierung
- **MAX:** Pre-Positioning-Formel (siehe Grundprinzip: MAX-Constraint)
- **CENTER:** Offset-Formel (siehe Grundprinzip: CENTER-Constraint) — danach CENTER → MIN demoten
- **SCALE:** nicht schreiben (ausser VECTOR) — Parent-Resize übernimmt das automatisch

#### Grösse
- `width` — skalieren, wenn `layoutSizingHorizontal === 'FIXED'`
- `height` — skalieren, wenn `layoutSizingVertical === 'FIXED'`

#### AutoLayout (nur wenn Node selbst ein AutoLayout-Frame ist)
- `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`
- `itemSpacing`
- `counterAxisSpacing` — nur wenn `layoutWrap === 'WRAP'`
- `minWidth`, `minHeight` — nur wenn Wert nicht `null`
- `maxWidth`, `maxHeight` — nur wenn Wert nicht `null`

#### Eckenradius
- `cornerRadius` — wenn Wert eine Zahl ist (nicht `Mixed`)
- `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius` — wenn `cornerRadius === Mixed` (jede Ecke einzeln)

#### Stroke
- `strokeWeight` — wenn Wert eine Zahl ist (nicht `Mixed`); **ohne ganzzahlige Rundung** (scaleExact), da Strichbreiten Subpixelwerte sinnvoll nutzen
- `strokeTopWeight`, `strokeBottomWeight`, `strokeLeftWeight`, `strokeRightWeight` — wenn `strokeWeight === Mixed` (jede Seite einzeln); ebenfalls ohne Rundung
- `dashPattern` — jeder Wert im Array skalieren (Strich- und Lückenlängen in Pixeln); ohne Rundung

#### Effects (direkt am Node, nicht via Style)
- **Blur** (`BACKGROUND_BLUR`, `LAYER_BLUR`): `radius` skalieren
- **Drop Shadow** und **Inner Shadow**: `radius` (blur), `spread`, `offset.x`, `offset.y` skalieren

#### Layout Grids (nur wenn Node ein Frame, Component oder COMPONENT_SET ist)

Für jeden Eintrag in `layoutGrids`:
- **ROWS / COLUMNS:** `gutterSize` skalieren; `sectionSize` skalieren (sofern vorhanden); `offset` skalieren (sofern vorhanden)
- **GRID:** `sectionSize` skalieren

#### Guides (nur wenn Node ein Frame ist)

Für jeden Eintrag in `guides`: `offset` skalieren.

#### CSS Grid (nur wenn Node `layoutMode === 'GRID'` hat)
- `gridRowGap`, `gridColumnGap` skalieren
- `gridRowSizes` und `gridColumnSizes`: jeden Eintrag mit `type === 'FIXED'` skalieren (`value` in Pixeln). Einträge mit `type === 'FLEX'` oder `'HUG'` nicht anfassen.

#### Text (nur wenn Node kein gebundenes Text Style hat)
- `fontSize` — wenn einheitlich (nicht `Mixed`); wenn `Mixed`: jede Range einzeln skalieren
- `lineHeight` — nur wenn `unit === 'PIXELS'`; wenn `Mixed`: jede Range einzeln
- `letterSpacing` — nur wenn `unit === 'PIXELS'`; wenn `Mixed`: jede Range einzeln
- `listSpacing` — immer skalieren (Pixelabstand zwischen Listenpunkten)

---

### Besondere Node-Typen

#### VECTOR-Nodes
`x`, `y`, `width`, `height` werden skaliert — **ohne ganzzahlige Rundung.** SVG-Pfadgeometrie verträgt Subpixelwerte und darf nicht willkürlich gerundet werden. Zusätzlich werden Stroke-Properties (`strokeWeight`, `dashPattern` etc.) wie bei anderen Nodes skaliert (ebenfalls ohne Rundung).

#### GROUP-Nodes
GROUPs haben keine eigene steuerbare Breite/Höhe — ihre Bounding Box ergibt sich aus den Kindern. Am GROUP-Node selbst werden **keine Properties geschrieben.** Die Kinder werden normal bottom-up traversiert und skaliert.

#### BOOLEAN_OPERATION-Nodes
Verhalten sich **vollständig wie GROUP-Nodes**: Die Bounding Box ergibt sich automatisch aus den Kind-Nodes. Am BOOLEAN_OPERATION-Node selbst werden **keine Properties geschrieben** — auch nicht `x` und `y`. Da die Bottom-Up-Traversal die Kinder zuerst verschiebt und Figma die Bounding Box des BOOLEAN_OPERATION-Nodes danach automatisch anpasst, würde ein explizites Schreiben von `x`/`y` eine Doppelskalierung der Position verursachen. Die Kinder werden normal bottom-up traversiert und skaliert.

#### SECTION-Nodes
SECTIONs haben keine `layoutSizing`-Properties und unterstützen keinen direkten Resize über die normalen Property-Setter. Stattdessen wird `resizeWithoutConstraints(newW, newH)` verwendet. Position wird normal über `scalePosition` gesetzt.

#### COMPONENT und COMPONENT_SET
Werden wie reguläre Frames behandelt: bottom-up traversiert, alle zutreffenden Properties skaliert. Kind-COMPONENTs innerhalb eines COMPONENT_SETs werden als eigenständige Nodes traversiert.

---

## Ausführungsreihenfolge & Abhängigkeiten

```
Schritt 1: Variables
    └─▶ Figma propagiert: padding, gap, radius, height
        in alle gebundenen Nodes — automatisch

Schritt 2: Text Styles
    └─▶ Figma propagiert: fontSize, lineHeight, letterSpacing
        in alle gebundenen TEXT-Nodes — automatisch

Schritt 3: Effect & Paint Styles
    └─▶ Figma propagiert: blur radius, shadow offset/spread, gradientTransform (e/f)
        in alle gebundenen Nodes — automatisch

Schritt 4: Canvas
    └─▶ Bottom-Up-Traversal aller Nodes auf allen Pages (inkl. hidden)
        Für jeden Node: Variable → Style → Instance-Overwrite → SCALE-Constraint prüfen
        Top-Level-Nodes: Anchor-basierte Positionsskalierung
        GROUP / BOOLEAN_OPERATION: nur Kinder traversieren, Node selbst nicht schreiben
        SECTION: resizeWithoutConstraints()
        VECTOR: manuell skalieren, SCALE/CENTER-Constraints danach demoten
        CENTER-Constraint (alle Nodes): Offset zurückrechnen, Zielposition direkt berechnen, danach CENTER → MIN demoten
        TEXT: textAutoResize-Modus vor/nach resize() erhalten
        Instances: nur explizite Overwrites skalieren, keine neuen Overwrites erzeugen
        → alle Nodes sind danach korrekt skaliert
```

---

## Nicht skalierte Werte

| Wert | Grund |
|---|---|
| COLOR-Variablen | Keine Pixelwerte |
| Fill-Farben (Solid, Gradient-Stops) | Keine Pixelwerte |
| Opacity | Kein Pixelwert |
| `lineHeight` mit `unit !== 'PIXELS'` | Skaliert sich implizit mit fontSize |
| `letterSpacing` mit `unit !== 'PIXELS'` | Relativ zum Font, kein absoluter Pixelwert |
| `paragraphSpacing`, `paragraphIndent` | Bewusste Design-Entscheidung: anders als `listSpacing` (Layout-Abstand) sind diese Werte typografische Feineinstellungen, die oft absichtlich nicht proportional zur Auflösung gewählt werden. Falls ein Projekt proportionale Skalierung wünscht, kann dies als Erweiterung ergänzt werden. |
| Component-Property-Namen und Varianten-Werte | Bezeichner, keine Pixelwerte |
| IMAGE fills | Keine skalierbaren Geometriewerte |
| `gradientTransform` Rotationskoeffizienten (a–d) | Dimensionslos, keine Pixelwerte |
| `GRADIENT_DIAMOND` | Nicht spezifiziert — wird stillschweigend übersprungen |
| `width`/`height` bei `layoutSizing === 'FILL'` oder `'HUG'` | Vom AutoLayout gesteuert, direktes Schreiben würde Modus brechen |
| `x`/`y` bei AutoLayout-Kindern (ohne `layoutPositioning === 'ABSOLUTE'`) | Vom AutoLayout gesteuert |
| `counterAxisSpacing` wenn `layoutWrap !== 'WRAP'` | Property existiert in diesem Modus nicht sinnvoll |
| `minWidth/maxWidth/minHeight/maxHeight` wenn `null` | Kein Constraint gesetzt |
| `gridRowSizes`/`gridColumnSizes` mit `type !== 'FIXED'` | FLEX (fr-Einheiten) und HUG sind relativ, keine absoluten Pixelwerte |
| `x`/`y` auf der AutoLayout-Achse bei GROUP-Kindern in AutoLayout | AutoLayout steuert diese Achse; explizites Schreiben kollidiert mit Auto-Repositionierung |
| `x`/`width` wenn `horizontal === 'SCALE'` (ausser VECTOR) | Figma skaliert diese Achse beim Parent-Resize automatisch |
| `y`/`height` wenn `vertical === 'SCALE'` (ausser VECTOR) | Figma skaliert diese Achse beim Parent-Resize automatisch |
| GROUP-Node-Properties | Bounding Box ergibt sich aus Kindern, kein direkter Schreibzugriff |
| BOOLEAN_OPERATION-Properties (inkl. x/y) | Bounding Box ergibt sich aus Kindern und wird automatisch aktualisiert; explizites x/y-Schreiben würde nach Bottom-Up-Traversal doppelskalieren |
| Instance-Properties ohne Overwrite | Erben vom skalierten Master-Component |
| Variable-gebundene Properties | Werden über Schritt 1 gesteuert |
| Style-gebundene Properties | Werden über Schritt 2/3 gesteuert |

---

*Spec-Version: 6.3 — Generisch, file-unabhängig, ohne Codebeispiele*
