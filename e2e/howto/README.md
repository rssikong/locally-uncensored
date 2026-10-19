# How-to recordings

One spec per how-to. A spec drives the real UI in Cloud mode through the test
rig (`Rec.boot`), and the recorder (`rec.ts`) photographs every state and
writes a timeline. `LU-HowTo/videos/_template/build.sh <id>` turns that into
the video. `music.spec.ts` is the worked example.

    LU_HOWTO_OUT=<LU-HowTo folder>/videos LU_E2E_PORT=<port> \
      npx playwright test e2e/howto/<id>.spec.ts --project=chromium --output=test-results-<id>
    sh <LU-HowTo folder>/videos/_template/build.sh <id> draft   # quick, writes renders/_sheet.png

## Rules

- The film shows the real UI. No DOM is injected or altered, with one standing
  exception already inside `Rec.boot` (the rig's red "ComfyUI is not running"
  line is hidden). To reach a state the rig cannot produce by itself, add a
  network fixture with `page.route` (see how the cloud mock answers) and say so
  in a comment and in your report. Never fake a state by editing the page.
- A how-to explains the things a user would not find alone. It does not explain
  "type a prompt, press Create".
- 3 to 5 scenes, 10 to 18 seconds. Each scene has one caption (`rec.scene`):
  one short English sentence, and it must be a fact of the product taken from
  `LU-HowTo/04-inhalte/04-INHALTE.md` or from the code you read. No advice the
  code does not back. No prices, no credit numbers in captions. No names of
  infrastructure vendors; model names as the UI shows them are fine.
- What is on screen must show what the caption says, at that moment.
- No text is drawn into the film. Captions live in steps.json only.
- Zoom the camera (`rec.cam(target, 1.4..1.6)`) onto the part being used and
  back to `'full'` when the whole window matters. Park the cursor beside a
  field before typing (`rec.move(point, { real: false })`), never on the text.
- Example content only: no real names, no real accounts. Typed text is your own
  wording (never existing song lyrics or other copyrighted text).
- Viewport 1200x1020 at deviceScaleFactor 2 for Create (a 16:9 result fits the
  stage there). Code and Agent may use 1440x900.
