// Compact mission dialogs and pass/fail cards. Kept separate from menu.js and
// hud.js so story UI never takes over the full-screen menu panel.
const STYLE_ID = 'mission-overlay-style';

const CSS = `
.mission-overlay {
  position: fixed;
  inset: 0;
  z-index: 46;
  display: grid;
  place-items: center;
  padding: 10px;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #fff3e0;
}
.mission-overlay[hidden] { display: none; }
.mission-overlay[data-kind="dialog"] { align-items: end; padding-bottom: max(12px, 7vh); }
.mission-overlay-card {
  width: min(88vw, 430px);
  padding: 9px 11px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 169, 72, 0.7);
  background: linear-gradient(150deg, rgba(32, 25, 49, 0.97), rgba(12, 13, 27, 0.97));
  box-shadow: 0 8px 26px rgba(5, 6, 15, 0.62), inset 0 0 18px rgba(255, 169, 72, 0.08);
  pointer-events: none;
  text-align: left;
}
.mission-overlay[data-kind="pass"] .mission-overlay-card { border-color: rgba(143, 240, 232, 0.75); }
.mission-overlay[data-kind="fail"] .mission-overlay-card { border-color: rgba(255, 51, 85, 0.8); }
.mission-overlay-kicker {
  font-size: 9px;
  letter-spacing: 2px;
  font-weight: 800;
  color: #8ff0e8;
  opacity: 0.85;
}
.mission-overlay-speaker {
  margin-top: 3px;
  font-size: 12px;
  letter-spacing: 1.6px;
  font-weight: 800;
  color: #ffd9a0;
}
.mission-overlay-title {
  margin-top: 4px;
  font-size: 16px;
  letter-spacing: 1.4px;
  font-weight: 800;
  color: #ffd9a0;
}
.mission-overlay-text {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: #fff3e0;
}
.mission-overlay-meta {
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 1px;
  font-weight: 800;
  color: #8ff0e8;
}
.mission-overlay-button {
  pointer-events: auto;
  display: block;
  margin: 8px 0 0 auto;
  min-width: 92px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 217, 160, 0.65);
  border-radius: 8px;
  background: rgba(255, 169, 72, 0.16);
  color: #ffd9a0;
  font: 800 10px/1.2 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 1.2px;
  touch-action: manipulation;
}
.mission-overlay-button:active { background: rgba(255, 169, 72, 0.34); }
`;

function ensureStyle() {
  if (!document || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

export class MissionOverlay {
  constructor(root, { toast = () => {} } = {}) {
    ensureStyle();
    this.root = root;
    this.toast = toast;
    this.isOpen = false;
    this.kind = null;
    this._lines = [];
    this._index = 0;
    this._done = null;
    this._after = null;
    this._doneCalled = false;

    this.el = document.createElement('div');
    this.el.className = 'mission-overlay';
    this.el.hidden = true;
    this.el.dataset.kind = 'none';
    this.el.setAttribute('aria-live', 'polite');
    this.card = document.createElement('div');
    this.card.className = 'mission-overlay-card';
    this.kicker = document.createElement('div');
    this.kicker.className = 'mission-overlay-kicker';
    this.speaker = document.createElement('div');
    this.speaker.className = 'mission-overlay-speaker';
    this.title = document.createElement('div');
    this.title.className = 'mission-overlay-title';
    this.text = document.createElement('p');
    this.text.className = 'mission-overlay-text';
    this.meta = document.createElement('div');
    this.meta.className = 'mission-overlay-meta';
    this.button = document.createElement('button');
    this.button.className = 'mission-overlay-button';
    this.button.type = 'button';
    this.button.addEventListener('click', () => this._advance());
    this.card.append(this.kicker, this.speaker, this.title, this.text, this.meta, this.button);
    this.el.appendChild(this.card);
    root.appendChild(this.el);
  }

  _open(kind) {
    this.kind = kind;
    this.el.dataset.kind = kind;
    this.el.hidden = false;
    this.isOpen = true;
  }

  dialog(speaker, lines, done) {
    this._lines = Array.isArray(lines) ? lines.slice() : lines ? [lines] : [];
    this._index = 0;
    this._done = typeof done === 'function' ? done : null;
    this._after = null;
    this._doneCalled = false;
    this._open('dialog');
    this.kicker.textContent = 'RADIO CALL';
    this.speaker.hidden = false;
    this.speaker.textContent = String(speaker || '');
    this.title.textContent = '';
    this.meta.textContent = '';
    if (!this._lines.length) {
      this._finishDialog();
      return;
    }
    this._renderLine();
  }

  _renderLine() {
    const last = this._index >= this._lines.length - 1;
    this.text.textContent = String(this._lines[this._index]);
    this.button.textContent = last ? 'GOT IT' : 'NEXT';
  }

  _advance() {
    if (this.kind === 'dialog') {
      if (this._index < this._lines.length - 1) {
        this._index++;
        this._renderLine();
      } else {
        this._finishDialog();
      }
      return;
    }
    const after = this._after;
    this._after = null;
    this.hide();
    if (typeof after === 'function') after();
  }

  _finishDialog() {
    const done = this._done;
    this._done = null;
    this.hide();
    if (typeof done === 'function' && !this._doneCalled) {
      this._doneCalled = true;
      done();
    }
  }

  showPass(info) {
    const data = typeof info === 'string' ? { message: info } : info || {};
    this._done = null;
    this._after = typeof data.done === 'function' ? data.done : null;
    this._open('pass');
    this.kicker.textContent = 'JOB COMPLETE';
    this.speaker.hidden = true;
    this.title.textContent = String(data.title || data.name || 'MISSION PASS');
    this.text.textContent = String(data.message || 'Objective complete. The city is moving with you.');
    this.meta.textContent = Number.isFinite(data.reward) ? `PAYOUT $${data.reward}` : '';
    this.button.textContent = 'CONTINUE';
  }

  showFail(info) {
    const data = typeof info === 'string' ? { message: info } : info || {};
    this._done = null;
    this._after = typeof data.done === 'function' ? data.done : null;
    this._open('fail');
    this.kicker.textContent = 'JOB FAILED';
    this.speaker.hidden = true;
    this.title.textContent = String(data.title || data.name || 'MISSION FAILED');
    this.text.textContent = String(data.message || data.reason || 'Run cancelled. Try again when you are ready.');
    this.meta.textContent = '';
    this.button.textContent = 'RETRY';
  }

  hide() {
    this.isOpen = false;
    this.kind = null;
    this.el.hidden = true;
    this.el.dataset.kind = 'none';
    this._lines = [];
    this._after = null;
  }
}

export default MissionOverlay;
