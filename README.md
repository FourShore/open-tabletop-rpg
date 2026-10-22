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

For production, `npm run build && npm start` serves everything from one port
(`PORT`, default 2567). `render.yaml` deploys it to Render as a single service.
Tables live in memory, so a server restart ends running games for now.

## Packages

- `packages/engine`: the rules engine, a pure TypeScript state machine that
  loads and validates a pack and runs its event deck (cards, checks, votes,
  shops, rewards, level-up tile draws). Grid combat is not built yet; combat
  cards pause and a phone reports the result.
- `packages/server`: Colyseus rooms joined by code. Each device keeps a token
  in localStorage, so a phone that reloads gets its heroes back. The screen
  and each phone get their own view (secret rolls only reach the roller).
- `packages/web`: Vite + React app with the home page, the main screen and
  the phone controller.

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
3. Grid combat
4. Progression: inventory, shop UI, campaign saves
5. Open ecosystem: pack loading by URL, a pack gallery, an editor

## License

Code is [MIT](LICENSE). The spec and the example pack's content are
[CC BY 4.0](spec/LICENSE.md).
