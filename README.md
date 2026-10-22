# Open Tabletop RPG

A browser-based co-op fantasy RPG. One shared screen shows the world, event
cards and a tactical combat grid; each player controls their hero from their
phone. Every rule, class, skill, enemy, event card and scenario comes from an
open JSON **game pack**, so anyone can write their own story.

- **Spec:** [`spec/`](spec/README.md) holds the JSON Schema, a reference pack
  ("The Hollow Road"), and a validator.
- **Design doc:** [Design & JSON Spec](https://claude.ai/artifact/JtztkqPLxJzu96KktcQQuw)

## Playing

```
npm install
npm run dev        # game server on :2567 and the web app on :5173
```

Open http://localhost:5173 on a laptop or TV and choose **Open the main
screen**. Players scan the QR code (or type the 4-letter room code) on their
phones, make a hero, and anyone can start. **Play solo** runs a whole party
from one device. Remote players can join the same code from anywhere and open
the main screen in their own browser.

Between cards each phone has a **Gear and items** panel: swap equipment,
drink a potion, or use a skill that works outside a fight. When a scenario
ends the party keeps its levels, gold and gear, and the next start carries on
into the scenario a win unlocked.

There are no accounts. A campaign is a small save file: **Download save** on
the main screen or a phone, and **Load a save file** in a lobby. The main
screen and phones also remember the latest save for the pack, so a new table
offers **Resume your last campaign**. Heroes from a save wait in the lobby
until a phone taps **Play as ...**; the same button lets a new phone take over
a hero whose phone is gone.

### Other adventures

The home page lists packs from [spec/gallery.json](spec/gallery.json) and
takes any `pack.json` URL. The browser fetches the pack and its includes (the
host must allow cross-origin requests, as GitHub raw and GitHub Pages do),
checks it, and hands it to the server with the new table; asset paths resolve
next to the pack's URL. A link like `/?pack=https://…/pack.json` opens the
home page with that pack chosen, so a pack can be shared as one link. To list
yours in the gallery, open a pull request adding it to `spec/gallery.json`.

The **pack editor** (`/editor`) opens the built-in pack, a URL or a file. Every
entry is editable as JSON, the validator runs as you type (click a problem to
jump to it), cards and maps have previews, and **Playtest** starts a solo
table with your draft. **Download pack.json** saves it as one file. The draft
stays in your browser.

For production, `npm run build && npm start` serves everything from one port
(`PORT`, default 2567). `render.yaml` deploys it to Render as a single service.
Tables live in memory: a server restart ends running scenarios, but the
campaign survives in the saved file.

## Packages

- `packages/engine`: the rules engine, a pure TypeScript state machine that
  loads and validates a pack and runs its event deck (cards, checks, votes,
  shops, rewards, level-up tile draws) and grid combat: two actions per hero,
  skills with range, areas and line of sight, attack and save rolls,
  conditions, cover, downed heroes and revives, and enemies that show their
  intent before acting on it.
- `packages/server`: Colyseus rooms joined by code. Each device keeps a token
  in localStorage, so a phone that reloads gets its heroes back. The screen
  and each phone get their own view (secret rolls only reach the roller).
- `packages/web`: Vite + React app with the home page and pack picker, the
  main screen, the phone controller and the pack editor.

```
npm test                                   # unit tests
npm run e2e                                # browser test: a screen and two phones play a scenario
npm run validate -- spec/example-pack      # check a pack
npm run play                               # play The Hollow Road in the terminal
npm run play -- --auto --seed 42           # watch it play itself
```

## Roadmap

1. Engine + spec (done)
2. Rooms: main screen and phone controllers over WebSockets (done)
3. Grid combat (done)
4. Progression: inventory, shop UI, campaign saves (done)
5. Open ecosystem: pack loading by URL, a pack gallery, an editor (done)

## License

Code is [MIT](LICENSE). The spec and the example pack's content are
[CC BY 4.0](spec/LICENSE.md).
